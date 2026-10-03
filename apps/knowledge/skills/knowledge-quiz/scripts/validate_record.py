#!/usr/bin/env python3
"""quiz-engine-v2: direct_quiz_queue_record へ渡す前の機械検証。

問題はアプリと同じ復習キューから受け取り、チャットで採点した結果を記録する。
このスクリプトは、ID集合・形式・引用照合・q値の決定的補正・文字数を確かめ、
ユーザー回答を含んでも安全な記録SQL（base64で包む）を作る。

使い方:
    python3 validate_record.py session.json grades.json

session.json  出題時に固定した非公開セッション状態
    {"contract_version":"quiz-engine-v2",
     "started":"<ISO8601>", "expires":"<ISO8601 = started+2h>",
     "items":[{"n":1,"item_id":123,"format":"四択",
               "choices":["..","..","..",".."],          # 四択のみ（受け取った順のまま）
               "correct_choice":".."}, ...]}              # 四択のみ

grades.json   採点結果（itemsと同順・同数）
    [{"answer":"ユーザーの実回答そのまま（四択は選ばれた選択肢の本文）",
      "quality":4,
      "quotes":["実回答中の30字以内の引用", ...],   # 空回答のときだけ []
      "note":"次回出題で狙うつまずき",
      "correct_answer":"模範解答（1〜2文）",
      "explanation":"この回答への講評（2〜4文）"}, ...]

出力: p_answers.json（DBへ渡す配列）と record.sql（base64で包んだ記録SQL）。
失敗したら非ゼロ終了。1件でも落ちたら記録しない。
"""

import base64
import json
import re
import sys
import unicodedata
from datetime import datetime

CONTRACT = "quiz-engine-v2"
ALLOWED_FORMATS = {"一問一答", "四択", "記述説明", "産出"}
MAX_ANSWER = 2000
MAX_NOTE = 2000
MAX_CORRECT = 4000
MAX_EXPLANATION = 8000


def norm(s: str) -> str:
    """NFKC化・小文字化・空白除去。引用照合はこの正規化後に行う。"""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s).lower())


def verdict_of(q: int) -> str:
    return "不正解" if q <= 1 else ("部分正解" if q == 2 else "正解")


def main(session_path: str, grades_path: str) -> int:
    session = json.load(open(session_path, encoding="utf-8"))
    grades = json.load(open(grades_path, encoding="utf-8"))
    items = session["items"]
    errors: list[str] = []

    if session.get("contract_version") != CONTRACT:
        errors.append(f"contract_version が {CONTRACT} ではない: {session.get('contract_version')!r}")

    # 2時間の有効期限
    try:
        expires = datetime.fromisoformat(session["expires"])
        if datetime.now(expires.tzinfo) > expires:
            errors.append(f"セッション失効（expires={session['expires']}）。記録せず放棄する。")
    except (KeyError, ValueError) as exc:
        errors.append(f"expires を解釈できない: {exc}")

    if len(items) != len(grades):
        errors.append(f"件数不一致: items={len(items)} grades={len(grades)}")
        print("\n".join("NG: " + e for e in errors), file=sys.stderr)
        return 1

    payload = []
    for item, g in zip(items, grades):
        n = item.get("n", "?")
        q = int(g["quality"])
        answer = str(g.get("answer", ""))
        quotes = g.get("quotes", [])
        note = str(g.get("note", ""))
        correct_answer = str(g.get("correct_answer", ""))
        explanation = str(g.get("explanation", ""))

        if not isinstance(item.get("item_id"), int) or item["item_id"] <= 0:
            errors.append(f"Q{n}: item_id が正の整数ではない: {item.get('item_id')!r}")
        if item.get("format") not in ALLOWED_FORMATS:
            errors.append(f"Q{n}: 形式 {item.get('format')!r} は契約外")
        if len(answer) > MAX_ANSWER:
            errors.append(f"Q{n}: 回答が{MAX_ANSWER}文字を超える")

        # 引用照合: 非空回答は実回答中に存在する30字以内の引用を1〜3件
        if answer.strip() == "":
            if quotes:
                errors.append(f"Q{n}: 空回答なのに引用がある")
            if q != 0:
                errors.append(f"Q{n}: 空回答は q0・不正解で固定する（q{q} が指定された）")
            q = 0
        else:
            if not 1 <= len(quotes) <= 3:
                errors.append(f"Q{n}: 引用は1〜3件（現在 {len(quotes)} 件）")
            for quote in quotes:
                if len(quote) > 30:
                    errors.append(f"Q{n}: 引用が30字超: {quote!r}")
                if norm(quote) not in norm(answer):
                    errors.append(f"Q{n}: 引用が実回答に存在しない: {quote!r}")

        # 四択の決定的q値補正: 正解は必ずq4（当て勘ぶんの上限）、誤答は最大q1。DB側でも同じ補正をかける
        if item.get("format") == "四択" and answer.strip():
            choices = item.get("choices") or []
            correct = item.get("correct_choice")
            if correct not in choices:
                errors.append(f"Q{n}: correct_choice が選択肢に無い")
            if answer.strip() not in choices:
                errors.append(f"Q{n}: 四択の回答は選択肢の本文そのものにする: {answer!r}")
            q = 4 if answer.strip() == correct else min(q, 1)

        if not 0 <= q <= 5:
            errors.append(f"Q{n}: q値が範囲外: {q}")
        if not note.strip():
            errors.append(f"Q{n}: note が空")
        if len(note) > MAX_NOTE:
            errors.append(f"Q{n}: note が{MAX_NOTE}文字を超える")
        if not correct_answer.strip():
            errors.append(f"Q{n}: correct_answer（模範解答）が空")
        if len(correct_answer) > MAX_CORRECT or len(explanation) > MAX_EXPLANATION:
            errors.append(f"Q{n}: 模範解答または講評が長すぎる")
        if not explanation.strip():
            errors.append(f"Q{n}: explanation（講評）が空")

        payload.append({
            "item_id": item.get("item_id"),
            "answer": answer.strip(),
            "quality": q,
            "verdict": verdict_of(q),
            "note": note.strip(),
            "correct_answer": correct_answer.strip(),
            "explanation": explanation.strip(),
        })

    ids = [p["item_id"] for p in payload]
    if len(set(ids)) != len(ids):
        errors.append("item_id が重複している")
    if set(ids) != {i.get("item_id") for i in items}:
        errors.append("出題と採点のitem_id集合が一致しない")

    if errors:
        print("\n".join("NG: " + e for e in errors), file=sys.stderr)
        print("\n検証に失敗した。direct_quiz_queue_record を呼ばないこと。", file=sys.stderr)
        return 1

    # 回答本文をSQLへ直接埋め込まない。base64の文字（英数字と + / =）だけにして、
    # どんな回答でもSQLリテラルを壊せないようにする。
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    encoded = base64.b64encode(body.encode("utf-8")).decode("ascii")
    assert re.fullmatch(r"[A-Za-z0-9+/=]+", encoded)

    with open("p_answers.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    with open("record.sql", "w", encoding="utf-8") as f:
        f.write(
            "select direct_quiz_queue_record("
            f"convert_from(decode('{encoded}', 'base64'), 'UTF8')::jsonb);\n"
        )

    dist = {q: sum(1 for p in payload if p["quality"] == q) for q in range(6)}
    print(f"OK: {len(payload)}件 / item_id集合一致 / 重複なし / 引用照合OK / 四択補正適用済み")
    print(f"q分布: {dist}")
    print("生成: p_answers.json, record.sql")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
