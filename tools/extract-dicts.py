#!/usr/bin/env python3
"""Extract locale namespace dictionaries from installed DSH client plugin bundles.

The shipped client bundles are self-contained `window.__ModuleLoader__.load({...})`
wrappers whose namespace dictionaries appear as literal objects passed to
`ctx.locale.register(NS, { zh, en })`. This tool recovers those dictionaries so a
language pack can be checked against the authoritative key set.

Usage:
    python3 tools/extract-dicts.py <asar-or-package-root> <out-dir>

`<asar-or-package-root>` is a directory containing `node_modules/@deepseek-ai/...`
source files; when pointed at an `.asar` archive the archive is read directly.
"""

from __future__ import annotations

import json
import os
import re
import struct
import sys

IDENT_START = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$")
IDENT_CHARS = IDENT_START | set("0123456789")


def skip_string(text: str, i: int) -> int:
    """Return the index just past the string literal starting at `i`."""
    quote = text[i]
    if quote == "`":
        i += 1
        depth = 0
        while i < len(text):
            ch = text[i]
            if ch == "\\":
                i += 2
                continue
            if ch == "$" and i + 1 < len(text) and text[i + 1] == "{":
                depth += 1
                i += 2
                continue
            if ch == "}" and depth:
                depth -= 1
                i += 1
                continue
            if ch == "`" and depth == 0:
                return i + 1
            i += 1
        return i
    i += 1
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == quote:
            return i + 1
        i += 1
    return i


def skip_trivia(text: str, i: int) -> int:
    while i < len(text):
        ch = text[i]
        if ch in " \t\r\n":
            i += 1
            continue
        if text.startswith("//", i):
            nl = text.find("\n", i)
            i = len(text) if nl < 0 else nl + 1
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i)
            i = len(text) if end < 0 else end + 2
            continue
        return i
    return i


def match_group(text: str, i: int) -> int:
    """Return the index just past the bracketed group starting at `i`."""
    closer = {"{": "}", "[": "]", "(": ")"}[text[i]]
    depth = 0
    while i < len(text):
        ch = text[i]
        if ch in "\"'`":
            i = skip_string(text, i)
            continue
        if text.startswith("//", i):
            nl = text.find("\n", i)
            i = len(text) if nl < 0 else nl + 1
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i)
            i = len(text) if end < 0 else end + 2
            continue
        if ch in "{[(":
            depth += 1
        elif ch in "}])":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return i


def split_top(inner: str) -> list[str]:
    """Split an argument/entry list on top-level commas."""
    parts: list[str] = []
    depth = 0
    i = 0
    start = 0
    while i < len(inner):
        ch = inner[i]
        if ch in "\"'`":
            i = skip_string(inner, i)
            continue
        if ch in "{[(":
            depth += 1
        elif ch in "}])":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(inner[start:i])
            start = i + 1
        i += 1
    tail = inner[start:]
    if tail.strip():
        parts.append(tail)
    return [p.strip() for p in parts if p.strip()]


def unescape(raw: str) -> str:
    def repl(match: re.Match[str]) -> str:
        body = match.group(1)
        mapping = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", "'": "'", '"': '"', "`": "`"}
        if body in mapping:
            return mapping[body]
        if body.startswith("u"):
            try:
                return chr(int(body[1:], 16))
            except ValueError:
                return match.group(0)
        return body

    return re.sub(r"\\(.)", repl, raw)


def string_literal(expr: str) -> str | None:
    """Return the value of a plain string literal (with `+` concatenation)."""
    out = []
    for piece in split_plus(expr.strip()):
        piece = piece.strip()
        m = re.fullmatch(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"", piece, re.S)
        if not m:
            return None
        raw = m.group(1) if m.group(1) is not None else m.group(2)
        out.append(unescape(raw))
    return "".join(out)


def split_plus(expr: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    i = 0
    start = 0
    while i < len(expr):
        ch = expr[i]
        if ch in "\"'`":
            i = skip_string(expr, i)
            continue
        if ch in "{[(":
            depth += 1
        elif ch in "}])":
            depth -= 1
        elif ch == "+" and depth == 0:
            parts.append(expr[start:i])
            start = i + 1
        i += 1
    parts.append(expr[start:])
    return parts


class Source:
    """One client bundle source text."""

    # Module-level lexical helper, exposed as a method for readability.
    string_literal = staticmethod(string_literal)

    def __init__(self, path: str, text: str) -> None:
        self.path = path
        self.text = text
        self.consts = self._collect_consts()

    # -- literal evaluation ------------------------------------------------

    def resolve(self, expr: str, depth: int = 0) -> str | None:
        """Resolve an identifier or literal expression to an object/string literal."""
        expr = expr.strip().rstrip(";").strip()
        if not expr or depth > 6:
            return None
        if expr[0] in "{[(" or expr[0] in "\"'`":
            return expr
        if re.fullmatch(r"[A-Za-z_$][\w$]*", expr):
            target = self.consts.get(expr)
            if target is None:
                return None
            return self.resolve(target, depth + 1)
        return None

    def _collect_consts(self) -> dict[str, str]:
        """Map `const NAME = <expr>` names to their raw expressions."""
        consts: dict[str, str] = {}
        for match in re.finditer(r"(?:^|[\n;])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*", self.text):
            name = match.group(1)
            i = skip_trivia(self.text, match.end())
            if i >= len(self.text):
                continue
            if self.text[i] in "{[(":
                consts.setdefault(name, self.text[i : match_group(self.text, i)].strip())
            elif self.text[i] in "\"'`":
                consts.setdefault(name, self.text[i : skip_string(self.text, i)].strip())
        return consts

    # -- extraction --------------------------------------------------------

    def object_entries(self, obj_expr: str) -> dict[str, str]:
        """Entries of an object literal whose values are literals or identifiers."""
        expr = obj_expr.strip()
        if not expr.startswith("{"):
            return {}
        inner = expr[1 : match_group(expr, 0) - 1]
        entries: dict[str, str] = {}
        for part in split_top(inner):
            key, sep, value = part.partition(":")
            if not sep:
                # Shorthand entry (`{ zh, en }`): the identifier names its own value.
                if re.fullmatch(r"[A-Za-z_$][\w$]*", part.strip()):
                    entries[part.strip()] = part.strip()
                continue
            key = key.strip()
            m = re.fullmatch(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"", key, re.S)
            if m:
                key = unescape(m.group(1) if m.group(1) is not None else m.group(2))
            elif not re.fullmatch(r"[A-Za-z_$][\w$]*", key):
                # Computed keys carry no dictionary value we can read.
                continue
            resolved = self.resolve(value)
            entries[key] = resolved if resolved is not None else value.strip()
        return entries

    def flat_dict(self, obj_expr: str) -> dict[str, str]:
        """Entries of an object literal, resolving identifier values to strings."""
        out: dict[str, str] = {}
        for key, raw in self.object_entries(obj_expr).items():
            if raw.startswith("{") or raw.startswith("["):
                continue
            value = string_literal(raw)
            if value is not None:
                out[key] = value
        return out

    def registrations(self) -> list[tuple[str, str, dict[str, str]]]:
        """Yield (namespace, locale, dictionary) for each readable register call."""
        found: list[tuple[str, str, dict[str, str]]] = []
        for match in re.finditer(r"\.register\(", self.text):
            i = skip_trivia(self.text, match.end())
            args_end = match_group(self.text, i - 1)
            args = split_top(self.text[i : args_end - 1])
            if len(args) < 2:
                continue
            ns_raw = self.resolve(args[0])
            if ns_raw is None:
                continue
            ns = string_literal(ns_raw)
            if ns is None:
                continue
            if len(args) >= 3:
                locale = string_literal(args[1])
                dict_expr = self.resolve(args[2])
                if locale is None or dict_expr is None:
                    continue
                found.append((ns, locale, self.flat_dict(dict_expr)))
                continue
            dict_expr = self.resolve(args[1])
            if dict_expr is None or not dict_expr.startswith("{"):
                continue
            for locale, value in self.object_entries(dict_expr).items():
                target = self.resolve(value)
                if re.fullmatch(r"[A-Za-z][A-Za-z0-9-]*", locale) and target and target.startswith("{"):
                    found.append((ns, locale, self.flat_dict(target)))
        return found


skipped_links: list[str] = []


def read_asar(path: str) -> dict[str, str]:
    """Return {internal/path: text} for every file in an asar archive."""
    with open(path, "rb") as handle:
        _, header_size, _, json_size = struct.unpack("<IIII", handle.read(16))
        header = json.loads(handle.read(json_size).decode("utf-8", "replace"))
        base = 8 + header_size
        out: dict[str, str] = {}
        global skipped_links
        skipped_links = []

        def walk(node: dict, prefix: str) -> None:
            for name, child in node.get("files", {}).items():
                current = f"{prefix}/{name}"
                if "files" in child:
                    walk(child, current)
                    continue
                if "offset" not in child:
                    # Symlink entries in the archive carry `link` and no payload.
                    skipped_links.append(current)
                    continue
                handle.seek(base + int(child["offset"]))
                out[current] = handle.read(child["size"]).decode("utf-8", "replace")

        walk(header, "")
    return out


def collect_sources(root: str) -> list[tuple[str, str]]:
    """Return (label, text) for every client bundle under `root`."""
    if os.path.isfile(root) and root.endswith(".asar"):
        files = read_asar(root)
        return [
            (path.split("/dsh/node_modules/", 1)[-1], text)
            for path, text in files.items()
            if path.endswith("/lib/client.js") and "/node_modules/@deepseek-ai/" in path
        ]
    out: list[tuple[str, str]] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        if "client.js" not in filenames or not dirpath.endswith("/lib"):
            continue
        if "/@deepseek-ai/" not in dirpath:
            continue
        full = os.path.join(dirpath, "client.js")
        with open(full, "r", encoding="utf-8", errors="replace") as handle:
            out.append((full, handle.read()))
    return out


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    root, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    merged: dict[str, dict[str, dict[str, str]]] = {}
    for label, text in sorted(collect_sources(root)):
        source = Source(label, text)
        for ns, locale, entries in source.registrations():
            if not entries:
                continue
            merged.setdefault(ns, {}).setdefault(locale, {}).update(entries)

    summary = []
    for ns, locales in sorted(merged.items()):
        safe = ns.replace("/", "_")
        with open(os.path.join(out_dir, f"{safe}.json"), "w", encoding="utf-8") as handle:
            json.dump(locales, handle, ensure_ascii=False, indent=1, sort_keys=True)
        summary.append(
            {
                "namespace": ns,
                "en": len(locales.get("en", {})),
                "zh": len(locales.get("zh", {})),
                "file": f"{safe}.json",
            }
        )
    with open(os.path.join(out_dir, "_index.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=1)
    total = sum(row["en"] for row in summary)
    print(f"namespaces: {len(summary)}  en keys: {total}  -> {out_dir}")
    for row in summary:
        print(f"  {row['namespace']:52s} en={row['en']:5d} zh={row['zh']:5d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
