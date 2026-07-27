from pathlib import Path

from .schemas import StoredCookie


def write_netscape_cookie_file(cookies: list[StoredCookie], path: Path) -> None:
    lines = ["# Netscape HTTP Cookie File\n"]
    for cookie in cookies:
        include_subdomains = "TRUE" if cookie.domain.startswith(".") else "FALSE"
        secure = "TRUE" if cookie.secure else "FALSE"
        expires = int(cookie.expirationDate or 0)
        domain = cookie.domain.replace("\t", "")
        name = cookie.name.replace("\t", "")
        value = cookie.value.replace("\t", "").replace("\n", "")
        cookie_path = cookie.path.replace("\t", "") or "/"
        lines.append(
            f"{domain}\t{include_subdomains}\t{cookie_path}\t{secure}\t{expires}\t{name}\t{value}\n"
        )
    path.write_text("".join(lines), encoding="utf-8")

