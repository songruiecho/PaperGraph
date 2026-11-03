from __future__ import annotations

import json
import re
from pathlib import Path

from pypdf import PdfReader


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ROOT = PROJECT_ROOT / "library"
OUT = PROJECT_ROOT / "dist" / "papers.json"

READ_MARKERS = ("✅", "√", "读完", "概述")
TITLE_STARTERS = (
    "Why", "Towards", "Improving", "Unveiling", "Principled", "Can", "How",
    "Empowering", "Let", "Mimicking", "True", "Boosting", "Contextually",
)

def is_read(name: str) -> bool:
    return any(marker in name for marker in READ_MARKERS)


def embedded_summary(name: str) -> str:
    stem = Path(name).stem
    if "读完-" not in stem:
        return ""
    body = stem.split("读完-", 1)[1]
    chunks = body.split("-")
    chinese = []
    for chunk in chunks:
        if re.search(r"[\u4e00-\u9fff]", chunk):
            chinese.append(chunk.strip())
    summary = "；".join(chinese)
    starter_pattern = r"\s+(?=(?:" + "|".join(TITLE_STARTERS) + r")\b)"
    summary = re.split(starter_pattern, summary, maxsplit=1)[0]
    return summary.strip(" -；")


def clean_title(name: str) -> str:
    stem = Path(name).stem
    stem = re.sub(r"^(?:✅️?\s*|√\s*|读完-)", "", stem)
    if "读完-" in Path(name).stem:
        starter_pattern = r"(?=(?:" + "|".join(TITLE_STARTERS) + r")\b)"
        start = re.search(starter_pattern, stem)
        if start:
            prefix = re.match(r"((?:19|20)\d{2})-([A-Za-z0-9 .^]+)-", stem)
            stem = ("-".join(prefix.groups()) + "-" if prefix else "") + stem[start.start():]
    elif re.search(r"[\u4e00-\u9fff]", stem):
        parts = stem.split("-")
        english_start = next((i for i, p in enumerate(parts) if re.search(r"[A-Za-z]{4}", p) and not re.search(r"[\u4e00-\u9fff]", p)), None)
        if english_start is not None:
            # Retain year/venue when the English title follows a Chinese note.
            prefix = [p for p in parts[:english_start] if re.fullmatch(r"(?:19|20)\d{2}|[A-Za-z][A-Za-z0-9 .^]+", p)]
            stem = "-".join(prefix + parts[english_start:])
    stem = stem.replace("_", " ")
    stem = re.sub(r"-Paper-Conference$", "", stem, flags=re.I)
    stem = re.sub(r"\s+", " ", stem).strip(" -")
    return stem


def infer_year(text: str) -> str:
    match = re.search(r"\b(20\d{2}|19\d{2})\b", text)
    return match.group(1) if match else "未知"


def infer_venue(text: str) -> str:
    venues = ["ACL", "NAACL", "EMNLP", "ICLR", "ICML", "NeurIPS", "CVPR", "ECCV", "COLM", "COLING", "AAAI", "SIGIR", "CIKM", "KDD", "TACL", "WACV", "ICASSP", "ACM MM", "TKDE", "TIP", "CSUR", "Nature Communications", "arXiv"]
    normalized = text.replace(".", "-").replace("_", " ")
    for venue in venues:
        if re.search(re.escape(venue), normalized, re.I):
            return venue
    return "未标注"


def extract_pdf_info(path: Path) -> tuple[str, str, str]:
    try:
        reader = PdfReader(str(path))
        meta = reader.metadata or {}
        author = str(meta.get("/Author") or "").strip()
        pdf_title = str(meta.get("/Title") or "").strip()
        pages = []
        for page in reader.pages[:2]:
            pages.append(page.extract_text() or "")
        text = re.sub(r"\s+", " ", " ".join(pages))
        abstract = ""
        match = re.search(r"\babstract\b\s*[:—-]?\s*(.{120,4000}?)(?=\b(?:1\.?\s+introduction|keywords?|index terms)\b)", text, re.I)
        if match:
            abstract = match.group(1).strip()
        elif text:
            abstract = text[:900].strip()
        return author, pdf_title, abstract
    except Exception:
        return "", "", ""


def short_abstract(text: str) -> str:
    if not text:
        return "已读；当前 PDF 未能自动提取摘要，可在右侧面板中补充或修改。"
    text = re.sub(r"\s+", " ", text).strip()
    sentences = re.split(r"(?<=[.!?。！？])\s+", text)
    chosen = " ".join(sentences[:2]).strip()
    if len(chosen) < 90:
        chosen = text[:420]
    if len(chosen) > 460:
        chosen = chosen[:457].rsplit(" ", 1)[0] + "…"
    return chosen


def infer_keywords(title: str, taxonomy: list[str]) -> list[str]:
    # The directory tree is the sole source of keywords. A paper belongs to
    # every directory level in its path, so nested folders naturally provide
    # multiple classifications without inventing new labels.
    return list(dict.fromkeys(taxonomy))


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    papers = []
    for index, path in enumerate(sorted(ROOT.rglob("*.pdf"), key=lambda p: str(p).lower()), start=1):
        rel = path.relative_to(ROOT)
        taxonomy = list(rel.parts[:-1])
        read = is_read(path.name)
        title = clean_title(path.name)
        author, pdf_title, abstract = extract_pdf_info(path) if read else ("", "", "")
        if pdf_title and len(pdf_title) > 10 and not re.search(r"Microsoft Word|arXiv", pdf_title, re.I):
            display_title = re.sub(r"\s+", " ", pdf_title).strip()
        else:
            display_title = title
        summary = embedded_summary(path.name)
        if read and not summary:
            summary = short_abstract(abstract)
        papers.append({
            "id": f"p{index}",
            "title": display_title,
            "filename": path.name,
            "year": infer_year(path.name),
            "venue": infer_venue(path.name),
            "authors": author or "PDF 元数据未提供",
            "taxonomy": taxonomy,
            "keywords": infer_keywords(display_title, taxonomy),
            "read": read,
            "summary": summary,
            "path": str(path),
            "sizeMB": round(path.stat().st_size / 1024 / 1024, 2),
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"papers": papers}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(papers)} papers ({sum(p['read'] for p in papers)} read) to {OUT}")


if __name__ == "__main__":
    main()
