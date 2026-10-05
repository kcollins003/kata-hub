"""Builds the two forms of the tracker page from tracker.src.html.

  python3 build.py                 -> out/tracker.page.html  (the preview: no backend, the count stays on the device)
  python3 build.py <backend url>   -> also out/tracker.html  (the page for katawarrior.com, talking to that backend)

The tests build their own copy (see test_site.py), so out/tracker.html is only ever the page for the site.
"""
import pathlib, re, sys

here = pathlib.Path(__file__).parent


def source():
    src = (here / "tracker.src.html").read_text()
    assert all(ord(c) < 128 for c in src), "tracker.src.html must stay plain ASCII"
    assert src.count("@@API@@") == 1
    return src


def site_page(api, title="Kata Warrior"):
    """The whole document for katawarrior.com, talking to the backend at this address."""
    src = source()
    assert re.fullmatch(r"https?://[A-Za-z0-9._~:/?#\[\]@!$&()*+,;=%-]+", api) and "'" not in api, "that does not look like a web address"
    m = re.fullmatch(r"<title>.*?</title>\n(<link [^>]+>)\n(<style>.*?</style>)\n\n(.*)", src, re.S)
    assert m, "tracker.src.html no longer starts with title, font link, style"
    font, style, body = m.group(1), m.group(2), m.group(3).replace("@@API@@", api)
    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#0a0908">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="{title}">
<link rel="apple-touch-icon" href="tracker-icon.png">
<link rel="icon" type="image/png" href="tracker-icon.png">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
{font}
{style}
</head>
<body>
{body.rstrip()}
</body>
</html>
"""
    assert all(ord(c) < 128 for c in doc)
    return doc


if __name__ == "__main__":
    src = source()
    out = here / "out"; out.mkdir(exist_ok=True)
    (out / "tracker.page.html").write_text(src.replace("@@API@@", ""))
    if len(sys.argv) > 1:
        doc = site_page(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "Kata Warrior")
        (out / "tracker.html").write_text(doc)
        print("site page:", len(doc), "bytes ->", out / "tracker.html")
    print("preview  :", len(src) - len("@@API@@"), "bytes ->", out / "tracker.page.html")
