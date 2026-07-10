# Muscu Tracker — installation sur Raspberry Pi (+ accès depuis le tel via Tailscale)

Objectif : l'app tourne en permanence sur la Pi, tes données vivent dans `data/muscu-data.json`,
et tu y accèdes **de partout** (y compris au gym en 4G) via Tailscale.

## Structure du projet

```
trackerz/
├── server.py            # back : API GET/PUT /api/data + sert le front
├── data/
│   ├── muscu-data.json      # tes données (la vraie base)
│   └── muscu-data.bak.json  # backup auto de la version précédente
├── public/              # front (aucune donnée dedans)
│   ├── index.html
│   ├── css/style.css
│   └── js/              # modules ES : app, store, workout, dashboard, exercises, metrics, utils
├── muscu.service        # démarrage auto (systemd)
└── lancer.command       # lanceur local Mac
```

> Migration : si tu avais l'ancienne version (fichiers à la racine), `server.py` déplace
> automatiquement `muscu-data.json` vers `data/` au premier lancement.

---

## 1. Copier le dossier sur la Pi

Depuis ton Mac (remplace `pi@raspberrypi.local` par ton user/host) :

```bash
scp -r /Users/linakaci/trackerz pi@raspberrypi.local:/home/pi/trackerz
```

> Pas de dépendance à installer : tout marche avec le Python3 déjà présent sur Raspberry Pi OS.

## 2. Tester le serveur

Sur la Pi (en SSH) :

```bash
cd /home/pi/trackerz
python3 server.py
```

Tu dois voir `Muscu Tracker → http://0.0.0.0:8000`.
Depuis un appareil **sur le même Wi-Fi**, ouvre `http://raspberrypi.local:8000` → l'app s'affiche.
Coupe avec `Ctrl+C` une fois validé.

## 3. Démarrage automatique (systemd)

Pour que l'app se relance toute seule au boot et après un crash :

```bash
# adapte User= et les chemins dans muscu.service si besoin (cat muscu.service)
sudo cp /home/pi/trackerz/muscu.service /etc/systemd/system/muscu.service
sudo systemctl daemon-reload
sudo systemctl enable --now muscu
systemctl status muscu        # doit être "active (running)"
```

Logs : `journalctl -u muscu -f`
Après une mise à jour des fichiers : `sudo systemctl restart muscu`

## 4. Accès de partout : Tailscale

Tailscale = petit VPN privé gratuit. Tes appareils se voient entre eux, **sans ouvrir de port** ni exposer quoi que ce soit publiquement.

**Sur la Pi :**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
Suis le lien affiché pour te connecter (compte Google/GitHub/email). Note l'adresse de la Pi :
```bash
tailscale ip -4          # ex. 100.x.y.z
```
(ou un nom type `raspberrypi.tail-xxxx.ts.net` dans l'admin Tailscale)

**Sur ton téléphone :** installe l'app **Tailscale** (App Store / Play Store), connecte-toi avec **le même compte**, active le VPN.

→ Maintenant, depuis ton tel **n'importe où** : `http://100.x.y.z:8000`

## 5. Ajouter à l'écran d'accueil (effet « vraie app »)

Sur ton téléphone, ouvre l'URL Tailscale dans le navigateur, puis :
- **iPhone (Safari)** : Partager → « Sur l'écran d'accueil »
- **Android (Chrome)** : menu ⋮ → « Ajouter à l'écran d'accueil »

L'app s'ouvre alors en plein écran avec l'icône haltère 🟧, comme une app native.

---

## Sauvegardes & données
- Tes données : `data/muscu-data.json` (lisible, éditable).
- Sauvegarde auto de la version précédente à chaque écriture : `data/muscu-data.bak.json`.
- Backup manuel rapide : `cp data/muscu-data.json data/muscu-data.$(date +%F).json`
  (ou le bouton **Exporter (JSON)** dans l'app).

## Dépannage
- **L'app charge mais affiche « hors-ligne »** : le serveur ne répond pas → `sudo systemctl status muscu`.
- **Inaccessible au gym** : vérifie que le VPN Tailscale est **activé** sur le tel et que la Pi est en ligne (admin Tailscale).
- **Changer de port** : édite `Environment=PORT=...` dans `muscu.service`, puis `daemon-reload` + `restart`.
