import os
import re
import io
import sys
import json
import time
import wave
import hashlib
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from google import genai
from google.genai import types

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AUDIO_DIR = os.path.join(BASE_DIR, "audio")
WAV_CACHE_DIR = os.path.join(BASE_DIR, "audio_cache")
MANIFEST_JS = os.path.join(BASE_DIR, "audio_manifest.js")
FFMPEG_EXE = r"C:\Windows\ffmpeg.exe" if os.path.exists(r"C:\Windows\ffmpeg.exe") else "ffmpeg"

os.makedirs(AUDIO_DIR, exist_ok=True)
os.makedirs(WAV_CACHE_DIR, exist_ok=True)


def load_env_manual(filepath):
    if not os.path.exists(filepath):
        return
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


for ep in [
    os.path.abspath(os.path.join(BASE_DIR, "../../🤖_AgentTools/Scripts/.env")),
    r"C:\Users\mattu\Documents\MyProjects\🤖_AgentTools\Scripts\.env",
]:
    if os.path.exists(ep):
        load_env_manual(ep)
        break

project_id = (
    os.getenv("PERSONAL_AI_PROJECT_ID")
    or os.getenv("CONSTRUCTION_GCP_PROJECT_ID")
    or os.getenv("VERTEX_AI_PROJECT_ID")
)
credentials_path = (
    os.getenv("PERSONAL_AI_CREDENTIALS")
    or os.getenv("CONSTRUCTION_GOOGLE_APPLICATION_CREDENTIALS")
    or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
)
for kp in [
    r"C:\Users\mattu\Documents\MyProjects\🤖_AgentTools\Scripts\Config\personal_key.json",
    r"C:\Users\mattu\Documents\MyProjects\🤖_AgentTools\Config\personal_key.json",
]:
    if (not credentials_path or not os.path.exists(credentials_path)) and os.path.exists(kp):
        credentials_path = kp
        break

if credentials_path and os.path.exists(credentials_path):
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path

vertex_client = genai.Client(vertexai=True, project=project_id, location="global") if project_id else None
aistudio_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
aistudio_client = genai.Client(api_key=aistudio_key) if aistudio_key else None

VOICE_NAME = "Leda"


def collect_all_texts():
    texts = set()
    fixed = [
        "休憩しましょう！深く息を吸って、ゆっくり吐いてくださいね。",
        "インターバルです。肩の力を抜いてリラックスしましょうね。",
        "いいペースですよ！呼吸を整えて、次のセットに備えましょう。",
        "セット2、いきましょう！イラストの矢印を意識して丁寧に動かしますよ。スタート！",
        "セット3です！きつくなってきたところからが一番効きますよ、一緒に頑張りましょう！",
        "ラスト、セット4です！反動を使わずに最後まで絞り切っていきましょう。スタートです！",
        "はい、ここで左右の手を入れ替えましょう！反対側も丁寧に効かせていきますよ！",
        "40分セッション完走、本当にお疲れ様でした！今日も素晴らしい積み重ねでしたね。最後に開脚の記録も残しておきましょう！",
        "瞑想まで含めたフルセッション完走、本当にお疲れ様でした！体も心もスッキリ整いましたね。最後に今日の記録も残しておきましょう！",
        "仕上げの5分間は、マイ瞑想音楽、の時間です。ゆっくりと深い呼吸を続けながら、穏やかな時間をお過ごしください。",
        "おはようございます！今朝は身体をいたわる15分ケア編成ですね。まずは深く息を吸って、肩と骨盤まわりをゆったりほぐしていきましょう。",
        "それでは股割り・柔軟ケアに入りましょう。朝一番の身体をやさしく目覚めさせるように、息を吐きながら伸ばしていきますよ。",
        "ストレッチお疲れ様でした！最後は5分間の瞑想で、頭と自律神経をスッキリ整えていきましょう。",
        "ナイスチャレンジです！ピンを1枚上げて、丁寧なフォームで効かせていきましょう！",
    ]
    for t in fixed:
        texts.add(t)

    data_js = open(os.path.join(BASE_DIR, "data.js"), "r", encoding="utf-8").read()
    json_match = re.search(r"window\.WORKOUT_DATA\s*=\s*(\{.*\})\s*;?\s*$", data_js, re.S)
    if json_match:
        wd = json.loads(json_match.group(1))
        for sp in wd.get("stretchPool", []):
            cat = (sp.get("category") or "").strip()
            if cat:
                texts.add(f"本日の股割りストレッチは、{cat}、のメニューです！息をふーっと吐きながら、気持ちよく伸ばしていきましょうね。")
        for mp in wd.get("meditationPool", []):
            if mp.get("speech"):
                texts.add(mp["speech"].strip())
        for group_key in ("homePlans", "hotelPlans"):
            for plan in (wd.get(group_key) or {}).values():
                for blk in plan.get("blocks", []):
                    for k in ("speech", "speechIntro"):
                        if blk.get(k):
                            texts.add(blk[k].strip())
    else:
        stretch_section = data_js.split("meditationPool")[0]
        for m in re.finditer(r"""['"]?category['"]?:\s*['"]([^'"]+)['"]""", stretch_section):
            cat = m.group(1).strip()
            texts.add(f"本日の股割りストレッチは、{cat}、のメニューです！息をふーっと吐きながら、気持ちよく伸ばしていきましょうね。")
        for m in re.finditer(r"""['"]?(?:speech|speechIntro)['"]?:\s*['"]([^'"]+)['"]""", data_js):
            val = m.group(1).strip()
            if val:
                texts.add(val)

    texts.add("本日の股割りストレッチは、マイ追加動画、のメニューです！息をふーっと吐きながら、気持ちよく伸ばしていきましょうね。")
    return sorted(texts)


def extract_pcm(audio_bytes):
    if not audio_bytes:
        return b""
    if audio_bytes[:4] == b"RIFF":
        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            pcm = wf.readframes(wf.getnframes())
    else:
        pcm = audio_bytes
    if len(pcm) % 2 != 0:
        pcm = pcm[:-1]
    return pcm


def wav_to_mp3(wav_path, mp3_path):
    tmp_mp3 = mp3_path + ".tmp.mp3"
    cmd = [
        FFMPEG_EXE,
        "-y",
        "-loglevel",
        "error",
        "-i",
        wav_path,
        "-ac",
        "1",
        "-ar",
        "24000",
        "-b:a",
        "48k",
        tmp_mp3,
    ]
    subprocess.run(cmd, check=True)
    os.replace(tmp_mp3, mp3_path)


def process_one(idx, total, text):
    full_hash = hashlib.sha1(("leda_v1:" + text).encode("utf-8")).hexdigest()
    short_hash = full_hash[:14]
    mp3_name = f"shoko_{short_hash}.mp3"
    mp3_path = os.path.join(AUDIO_DIR, mp3_name)
    wav_path = os.path.join(WAV_CACHE_DIR, f"shoko_{full_hash}.wav")

    if os.path.exists(mp3_path) and os.path.getsize(mp3_path) > 500:
        return text, f"./audio/{mp3_name}", "cached_mp3"

    # Reuse existing WAV cache if present
    if os.path.exists(wav_path) and os.path.getsize(wav_path) > 500:
        wav_to_mp3(wav_path, mp3_path)
        print(f"[{idx+1}/{total}] OK (wav_cache) -> {mp3_name}", flush=True)
        return text, f"./audio/{mp3_name}", "from_wav_cache"

    speech_cfg = types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE_NAME)
        )
    )
    gen_cfg = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=speech_cfg,
    )

    attempts = []
    if vertex_client:
        attempts.extend([
            ("vertex", vertex_client, "gemini-3.8-flash-tts"),
            ("vertex", vertex_client, "gemini-3.8-flash-lite-tts"),
            ("vertex", vertex_client, "gemini-2.5-flash-tts"),
        ])
    if aistudio_client:
        attempts.extend([
            ("aistudio", aistudio_client, "gemini-3.8-flash-tts"),
            ("aistudio", aistudio_client, "gemini-3.8-flash-lite-tts"),
        ])

    if not attempts:
        raise RuntimeError("No Vertex AI or AI Studio credentials found!")

    # Spread starting model across workers to maximize throughput
    if idx % 3 == 1 and len(attempts) >= 2:
        attempts = attempts[1:] + attempts[:1]

    last_err = "unknown"
    for round_try in range(5):
        for prov, cli, mdl in attempts:
            try:
                resp = cli.models.generate_content(
                    model=mdl,
                    contents=text,
                    config=gen_cfg,
                )
                part = resp.candidates[0].content.parts[0]
                if part.inline_data and part.inline_data.data:
                    pcm = extract_pcm(part.inline_data.data)
                    if pcm:
                        with wave.open(wav_path, "wb") as wf:
                            wf.setnchannels(1)
                            wf.setsampwidth(2)
                            wf.setframerate(24000)
                            wf.writeframes(pcm)
                        wav_to_mp3(wav_path, mp3_path)
                        print(f"[{idx+1}/{total}] OK ({prov}:{mdl}) -> {mp3_name}", flush=True)
                        return text, f"./audio/{mp3_name}", f"{prov}:{mdl}"
            except Exception as e:
                last_err = f"{prov}:{mdl} {str(e)[:120]}"
                time.sleep(1.5 * (round_try + 1))
                continue

    raise RuntimeError(f"Failed TTS for '{text[:25]}': {last_err}")


def main():
    texts = collect_all_texts()
    total = len(texts)
    print(f"Synthesizing {total} unique Shoko-san voice lines to MP3...", flush=True)

    manifest = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(process_one, i, total, t) for i, t in enumerate(texts)]
        for fut in as_completed(futures):
            text, rel_url, status = fut.result()
            manifest[text] = rel_url

    # Write deterministic audio_manifest.js
    ordered = {k: manifest[k] for k in sorted(manifest.keys())}
    js_content = (
        "// Auto-generated Shoko-san (Gemini TTS Leda) static audio manifest\n"
        "window.SHOKO_AUDIO_MANIFEST = "
        + json.dumps(ordered, ensure_ascii=False, indent=2)
        + ";\n"
    )
    with open(MANIFEST_JS, "w", encoding="utf-8") as f:
        f.write(js_content)

    total_bytes = sum(
        os.path.getsize(os.path.join(AUDIO_DIR, fn))
        for fn in os.listdir(AUDIO_DIR)
        if fn.endswith(".mp3")
    )
    print(
        f"DONE! {len(ordered)}/{total} MP3s ready in audio/ ({total_bytes / 1024 / 1024:.2f} MB). Wrote audio_manifest.js.",
        flush=True,
    )


if __name__ == "__main__":
    main()
