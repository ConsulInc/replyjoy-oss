import { eq } from "drizzle-orm";
import type { Request } from "express";
import { clerkClient, getAuth } from "@clerk/express";

import { db } from "../db/client.js";
import { createId } from "../lib/id.js";
import { userSettings, users } from "../db/schema.js";

function getStringClaim(
  claims: Record<string, unknown> | undefined,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = claims?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

async function loadClerkProfile(userId: string) {
  const clerkUser = await clerkClient.users.getUser(userId);
  const primaryEmail =
    clerkUser.emailAddresses.find(
      (emailAddress) => emailAddress.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;

  return {
    email: primaryEmail,
    firstName: clerkUser.firstName ?? undefined,
    lastName: clerkUser.lastName ?? undefined,
    imageUrl: clerkUser.imageUrl ?? undefined,
  };
}

export async function ensureLocalUser(req: Request) {
  const auth = getAuth(req);
  if (!auth.userId) {
    throw new Error("Missing Clerk user");
  }

  const claims = auth.sessionClaims as Record<string, unknown> | undefined;
  let email = getStringClaim(claims, "email", "email_address");
  let firstName = getStringClaim(claims, "first_name", "given_name");
  let lastName = getStringClaim(claims, "last_name", "family_name");
  let imageUrl = getStringClaim(claims, "image_url", "picture");

  const existing = await db.query.users.findFirst({
    where: eq(users.clerkUserId, auth.userId),
    with: { settings: true },
  });

  const needsClerkProfile =
    (!email && !existing?.email) ||
    (!firstName && !existing?.firstName) ||
    (!lastName && !existing?.lastName) ||
    (!imageUrl && !existing?.avatarUrl);

  if (needsClerkProfile) {
    const clerkProfile = await loadClerkProfile(auth.userId);
    email ??= clerkProfile.email;
    firstName ??= clerkProfile.firstName;
    lastName ??= clerkProfile.lastName;
    imageUrl ??= clerkProfile.imageUrl;
  }

  if (existing) {
    if (
      (email && existing.email !== email) ||
      (firstName && existing.firstName !== firstName) ||
      (lastName && existing.lastName !== lastName) ||
      (imageUrl && existing.avatarUrl !== imageUrl)
    ) {
      await db
        .update(users)
        .set({
          email: email ?? existing.email,
          firstName: firstName ?? existing.firstName,
          lastName: lastName ?? existing.lastName,
          avatarUrl: imageUrl ?? existing.avatarUrl,
        })
        .where(eq(users.id, existing.id));
    }

    if (!existing.settings) {
      await db
        .insert(userSettings)
        .values({
          id: createId("settings"),
          userId: existing.id,
        })
        .onConflictDoNothing({ target: userSettings.userId });
      const refreshedUser = await db.query.users.findFirst({
        where: eq(users.id, existing.id),
        with: { settings: true },
      });
      if (!refreshedUser) {
        throw new Error("Failed to reload local user after creating settings");
      }
      return refreshedUser;
    }

    const refreshedExistingUser = await db.query.users.findFirst({
      where: eq(users.id, existing.id),
      with: { settings: true },
    });
    if (!refreshedExistingUser) {
      throw new Error("Failed to reload local user after updating profile");
    }
    return refreshedExistingUser;
  }

  const userId = createId("user");
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({
        id: userId,
        clerkUserId: auth.userId!,
        email: email ?? null,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        avatarUrl: imageUrl ?? null,
      })
      .onConflictDoNothing({ target: users.clerkUserId });

    const insertedOrExistingUser = await tx.query.users.findFirst({
      where: eq(users.clerkUserId, auth.userId!),
    });
    if (!insertedOrExistingUser) {
      throw new Error("Failed to load local user after insert");
    }

    await tx
      .insert(userSettings)
      .values({
        id: createId("settings"),
        userId: insertedOrExistingUser.id,
      })
      .onConflictDoNothing({ target: userSettings.userId });
  });

  const createdUser = await db.query.users.findFirst({
    where: eq(users.clerkUserId, auth.userId),
    with: { settings: true },
  });
  if (!createdUser) {
    throw new Error("Failed to load newly created local user");
  }
  return createdUser;
}
