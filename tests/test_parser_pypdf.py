from rag_ingestion.parser_pypdf import text_quality


def test_text_quality_accepts_normal_english():
    assert text_quality("This is a normal English syllabus paragraph.") == "ok"


def test_text_quality_rejects_obvious_mojibake():
    assert text_quality("¸ÀÀA¥ÁzÀPÀgÀÄ ¥ÉÆæ. «. PÉÃ±ÀªÀªÀÄÆwð") == "mojibake"
