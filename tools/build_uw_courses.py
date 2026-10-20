"""Builds uw-courses.json from the UW Seattle course catalog (https://www.washington.edu/students/crscat/).

Run once a year or so to pick up new courses:
    python3 tools/build_uw_courses.py
"""
import html
import json
import re
import time
import urllib.request
from pathlib import Path

CATALOG = "https://www.washington.edu/students/crscat/"
OUT = Path(__file__).resolve().parent.parent / "uw-courses.json"
MAX_NUMBER = 599  # skip 600+ (thesis/dissertation/research credits)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "dspscholarship course list builder"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def clean(text):
    return re.sub(r"\s+", " ", html.unescape(text).replace("\xa0", " ")).strip()


def main():
    index = fetch(CATALOG)
    depts = {}  # prefix -> department name
    pages = {}  # page -> prefix
    for page, label in re.findall(r'<a href="([a-z0-9_]+\.html)">([^<]+)</a>', index):
        m = re.match(r"(.+) \(([A-Z& ]+)\)$", clean(label))
        if m:
            depts[m.group(2)] = m.group(1)
            pages[page] = m.group(2)

    courses = {}
    for i, (page, prefix) in enumerate(sorted(pages.items())):
        try:
            text = fetch(CATALOG + page)
        except Exception as err:  # one bad page shouldn't stop the build
            print(f"skipped {page}: {err}")
            continue
        for raw in re.findall(r'<a name="[^"]*"><p><b>(.*?)</b>', text, flags=re.S):
            heading = clean(re.sub(r"<[^>]+>", "", raw))
            m = re.match(rf"({re.escape(prefix)}) (\d{{3}})[A-Z]? (.+?) \(", heading)
            if m and int(m.group(2)) <= MAX_NUMBER:
                courses[f"{m.group(1)} {m.group(2)}"] = m.group(3)
        if i % 25 == 0:
            print(f"{i}/{len(pages)} pages, {len(courses)} courses")
        time.sleep(0.2)  # be polite to the UW server

    used = sorted({code.rsplit(" ", 1)[0] for code in courses})
    data = {
        "source": CATALOG,
        "built": time.strftime("%Y-%m-%d"),
        "departments": {p: depts[p] for p in used},
        "courses": sorted(courses.items()),
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {len(courses)} courses in {len(used)} departments to {OUT.name}")


if __name__ == "__main__":
    main()
