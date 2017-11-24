#!/bin/bash

ffprobe_cmd=/usr/local/bin/ffprobe
mode=$1

if [ "$mode" = "" ]; then
    mode="main"
fi

function getHeight() {
    echo `$ffprobe_cmd -v 0 -show_streams -of flat=s=_:h=0 "$INPUT" | grep stream_0_width | awk -F= '{print \$2}'`
}

if [ `getHeight` -gt 720 ]; then
    $FFMPEG -dual_mono_mode $mode -i "$INPUT" -filter:v yadif -c:v libx264 -crf 23 -f mp4 -s 1280x720 -c:a aac -ar 48000 -ab 192k -ac 2 "$OUTPUT"
else
    $FFMPEG -dual_mono_mode $mode -i "$INPUT" -filter:v yadif -c:v libx264 -crf 23 -f mp4 -s 720x480 -c:a aac -ar 48000 -ab 128k -ac 2 "$OUTPUT"
fi

