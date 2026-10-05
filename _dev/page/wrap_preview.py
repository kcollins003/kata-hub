"""Wrap the preview fragment (out/tracker.page.html) in a document for local testing, with Cinzel from local files."""
import pathlib
here = pathlib.Path(__file__).parent
frag = (here / "out" / "tracker.page.html").read_text()
fonts = (here.parent / "shelved" / "fonts").resolve()
face = "".join(
    f"@font-face{{font-family:'Cinzel';font-weight:{w};src:url('file://{fonts}/Cinzel-{n}.ttf')}}"
    for w, n in ((400, "Regular"), (600, "Bold"), (900, "Black")))
doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}}
body{{margin:0;font:14px system-ui,sans-serif;background:#faf9f5}}img{{max-width:100%}}[hidden]{{display:none!important}}
{face}</style></head><body>
{frag}
</body></html>"""
(here / "out" / "local.html").write_text(doc)
print(here / "out" / "local.html")
