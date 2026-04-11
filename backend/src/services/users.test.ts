import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuth = vi.fn();
const getUser = vi.fn();
const usersFindFirst = vi.fn();
const updateWhere = vi.fn();
const updateSet = vi.fn();

vi.mock("@clerk/express", () => ({
  getAuth,
  clerkClient: {
    users: {
      getUser,
    },
  },
}));

vi.mock("../db/client.js", () => ({
  db: {
    query: {
      users: {
        findFirst: usersFindFirst,
      },
    },
    update: vi.fn(() => ({ set: updateSet })),
  },
}));

describe("ensureLocalUser", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    updateSet.mockReturnValue({ where: updateWhere });
    updateWhere.mockResolvedValue(undefined);
  });

  it("hydrates an existing local user from Clerk when token claims omit the profile", async () => {
    getAuth.mockReturnValue({
      userId: "clerk_user_123",
      sessionClaims: {},
    });

    usersFindFirst
      .mockResolvedValueOnce({
        id: "user_123",
        clerkUserId: "clerk_user_123",
        email: null,
        firstName: null,
        lastName: null,
        avatarUrl: null,
        settings: { id: "settings_123" },
      })
      .mockResolvedValueOnce({
        id: "user_123",
        clerkUserId: "clerk_user_123",
        email: "person@example.com",
        firstName: "Derek",
        lastName: "Bai",
        avatarUrl: "https://example.com/avatar.png",
        settings: { id: "settings_123" },
      });

    getUser.mockResolvedValue({
      primaryEmailAddressId: "email_123",
      emailAddresses: [{ id: "email_123", emailAddress: "person@example.com" }],
      firstName: "Derek",
      lastName: "Bai",
      imageUrl: "https://example.com/avatar.png",
    });

    const { ensureLocalUser } = await import("./users.js");
    const result = await ensureLocalUser({} as never);

    expect(getUser).toHaveBeenCalledWith("clerk_user_123");
    expect(updateSet).toHaveBeenCalledWith({
      email: "person@example.com",
      firstName: "Derek",
      lastName: "Bai",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(result.email).toBe("person@example.com");
    expect(result.firstName).toBe("Derek");
  });
});
