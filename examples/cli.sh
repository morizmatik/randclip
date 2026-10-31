#!/bin/sh
# Three random 4-second segments from each of two videos, saved to ./samples.
# Replace the placeholders with links you have the right to use.
set -e
randclip --per 3 --len 4 --out ./samples \
  "https://youtu.be/VIDEO_ID" \
  "https://youtu.be/OTHER_ID"
