#!/usr/bin/env bash
# Генерирует демо-медиа для `npm run seed` (нужны ffmpeg и ImageMagick).
# Результат уже закоммичен в apps/server/seed-assets — запускать не обязательно.
set -euo pipefail
OUT="$(cd "$(dirname "$0")/.." && pwd)/apps/server/seed-assets"
FONT="${FONT:-/usr/share/fonts/opentype/inter/Inter-Bold.otf}"
mkdir -p "$OUT"
cd "$OUT"

palettes=("#ff6b6b-#4ecdc4" "#7c5cff-#ffb86b" "#00c6ff-#0072ff" "#f7971e-#ffd200" "#ee0979-#ff6a00"
          "#11998e-#38ef7d" "#8e2de2-#4a00e0" "#fc5c7d-#6a82fb" "#43cea2-#185a9d" "#ff9a9e-#fad0c4"
          "#a18cd1-#fbc2eb" "#30cfd0-#330867")
for i in "${!palettes[@]}"; do
  size=$([ $((i % 3)) -eq 0 ] && echo "960x1200" || echo "960x960")
  convert -size "$size" -seed $((i * 7 + 3)) "plasma:${palettes[$i]}" -blur 0x10 -modulate 105,135 -quality 80 "photo-$((i + 1)).jpg"
done

names=("А" "Б" "М" "Д" "Е" "К" "Л" "Н" "О" "С")
colors=("#7c5cff" "#ff6b6b" "#00b894" "#0984e3" "#e17055" "#6c5ce7" "#fd79a8" "#00cec9" "#fdcb6e" "#2d3436")
for i in "${!names[@]}"; do
  convert -size 256x256 "radial-gradient:${colors[$i]}-#111111" -gravity center -font "$FONT" -pointsize 120 \
    -fill white -annotate +0+6 "${names[$i]}" -quality 85 "avatar-$((i + 1)).jpg"
done

for i in 1 2 3; do
  convert -size 1500x500 -seed $((i * 13)) "plasma:${palettes[$i]}" -blur 0x30 -quality 78 "banner-$i.jpg"
done

enc=(-c:v libx264 -profile:v main -pix_fmt yuv420p -preset veryfast -crf 31 -movflags +faststart -an)
ffmpeg -y -loglevel error -f lavfi -i "mandelbrot=s=640x360:rate=24" -t 12 "${enc[@]}" video-1.mp4
ffmpeg -y -loglevel error -f lavfi -i "life=s=320x180:mold=10:r=24:ratio=0.1:death_color=#3a0ca3:life_color=#f72585,scale=640:360:flags=neighbor" -t 8 "${enc[@]}" -crf 40 video-2.mp4
ffmpeg -y -loglevel error -f lavfi -i "gradients=s=640x360:c0=#7c5cff:c1=#00d4ff:c2=#ff6b6b:x0=0:y0=0:x1=640:y1=360:speed=0.02:rate=24" -t 12 "${enc[@]}" video-3.mp4
ffmpeg -y -loglevel error -f lavfi -i "cellauto=s=640x360:rule=110:rate=24,negate,colorchannelmixer=.3:.4:.3:0:.2:.5:.3:0:.6:.2:.8" -t 12 "${enc[@]}" video-4.mp4
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=s=640x360:rate=24" -t 10 "${enc[@]}" video-5.mp4

ffmpeg -y -loglevel error -f lavfi -i "gradients=s=360x640:c0=#ff006e:c1=#8338ec:c2=#3a86ff:speed=0.05:rate=30" -t 8 "${enc[@]}" short-1.mp4
ffmpeg -y -loglevel error -f lavfi -i "mandelbrot=s=360x640:rate=30:start_scale=2:end_scale=0.05" -t 8 "${enc[@]}" short-2.mp4
ffmpeg -y -loglevel error -f lavfi -i "life=s=180x320:mold=25:r=24:ratio=0.3:life_color=#06d6a0:death_color=#073b4c,scale=360:640:flags=neighbor" -t 6 "${enc[@]}" -crf 42 short-3.mp4
ffmpeg -y -loglevel error -f lavfi -i "gradients=s=360x640:c0=#ffbe0b:c1=#fb5607:c2=#ff006e:c3=#8338ec:speed=0.08:type=radial:rate=30" -t 8 "${enc[@]}" short-4.mp4
ffmpeg -y -loglevel error -f lavfi -i "gradients=s=360x640:c0=#00f5d4:c1=#00bbf9:c2=#9b5de5:speed=0.03:type=spiral:rate=30" -t 8 "${enc[@]}" short-5.mp4

for f in video-*.mp4 short-*.mp4; do
  ffmpeg -y -loglevel error -ss 1.5 -i "$f" -frames:v 1 -q:v 4 "${f%.mp4}-poster.jpg"
done
du -sh "$OUT"
