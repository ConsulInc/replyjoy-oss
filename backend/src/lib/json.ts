function isJsonValueDelimiter(char: string | undefined) {
  return char === undefined || char === "," || char === "}" || char === "]" || char === ":";
}

function getNextNonWhitespace(raw: string, start: number) {
  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];
    if (!/\s/.test(char)) {
      return char;
    }
  }

  return undefined;
}

function repairMalformedJson(raw: string) {
  let inString = false;
  let escaped = false;
  let output = "";

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];

    if (!inString) {
      output += char;

      if (char === '"') {
        inString = true;
      }

      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      const nextChar = getNextNonWhitespace(raw, i + 1);
      if (!isJsonValueDelimiter(nextChar)) {
        output += "\\\"";
      } else {
        output += char;
        inString = false;
      }

      continue;
    }

    output += char;
  }

  return output;
}

function findCandidateJson(raw: string) {
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== "{") {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === "\"") {
          inString = false;
        }

        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
        continue;
      }

      if (char !== "}") {
        continue;
      }

      depth -= 1;
      if (depth !== 0) {
        continue;
      }

      return raw.slice(start, index + 1);
    }
  }

  return null;
}

function findFirstJsonObject(raw: string) {
  const candidate = findCandidateJson(raw);
  if (!candidate) {
    return null;
  }

  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return candidate;
  }
}

export function extractJson<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]+?)```/i)?.[1];
  const candidate = fenced ?? trimmed;
  const jsonObject = findFirstJsonObject(candidate);
  if (!jsonObject) {
    throw new Error(`Model did not return JSON: ${raw}`);
  }

  try {
    return JSON.parse(jsonObject) as T;
  } catch {
    const repaired = repairMalformedJson(jsonObject);
    return JSON.parse(repaired) as T;
  }
}
