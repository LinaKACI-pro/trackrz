#!/bin/bash
# Double-clique ce fichier dans le Finder pour lancer Muscu Tracker en local.
cd "$(dirname "$0")"

BIN="./trackrz-server"
if [ ! -x "$BIN" ]; then
  BIN="./.bench-tools/trackrz-server"
fi
if [ ! -x "$BIN" ]; then
  echo "Binaire Zig absent. Lance d'abord le build du backend."
  exit 1
fi

echo "Muscu Tracker → http://localhost:8000"
echo "Laisse cette fenêtre ouverte pendant que tu utilises l'app. Ferme-la (ou Ctrl+C) pour arrêter."
( sleep 1 && open "http://localhost:8000/" ) &
HOST=127.0.0.1 PORT=8000 "$BIN"
