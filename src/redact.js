const patterns = [
  [/\b(gh[opsu]_[A-Za-z0-9]{20,})\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\b(sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED_API_KEY]"],
  [/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s]+/gi, "$1[REDACTED]"],
  [/((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]"],
  [/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, "$1[REDACTED]$2"]
];

export function redact(value) {
  let output = String(value ?? "");
  for (const [pattern, replacement] of patterns) output = output.replace(pattern, replacement);
  return output;
}

export function redactValue(value, key = "") {
  if (/password|passwd|secret|token|api[_-]?key|authorization/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactValue(item, name)]));
  return value;
}

export function publicEnv(names, env = process.env) {
  return names.map((name) => ({ name, status: env[name] ? "configured" : "missing" }));
}
