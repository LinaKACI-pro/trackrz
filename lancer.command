#!/bin/bash
# Double-clique ce fichier dans le Finder pour lancer Muscu Tracker via un serveur local.
# (Le mode serveur rend la sauvegarde auto dans muscu-data.json 100% fiable.)
cd "$(dirname "$0")"
echo "Muscu Tracker → http://localhost:8000"
echo "Laisse cette fenêtre ouverte pendant que tu utilises l'app. Ferme-la (ou Ctrl+C) pour arrêter."
( sleep 1 && open "http://localhost:8000/" ) &
python3 server.py
