#!/bin/sh
# Собирает рекламный ролик целиком: кадры из настоящей игры, музыка, сведение.
# Нужны Node.js с Playwright (Chromium), Python 3 с numpy и ffmpeg.
set -e
cd "$(dirname "$0")"
node render.js "$@"
python3 music.py
ffmpeg -y -loglevel error -i out/video.mp4 -i out/music.wav -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart -shortest korona-promo.mp4
ffmpeg -y -loglevel error -ss 31.5 -i korona-promo.mp4 -frames:v 1 -q:v 3 poster.jpg
echo "готово: promo/korona-promo.mp4"
