# Muscu Tracker — déploiement sur un VPS (HTTPS + mot de passe)

Objectif : l'app accessible depuis ton téléphone **partout**, via une URL HTTPS,
protégée par mot de passe. Budget : **~4 €/mois** (VPS) + un sous-domaine gratuit.

Architecture :
```
Téléphone ──HTTPS──> Caddy (certificat auto) ──localhost──> server.py (auth mdp) ──> data/muscu-data.json
```

---

## 1. Louer le VPS (~5 min)

Le moins cher qui marche très bien :
- **Hetzner Cloud** CX22 (~3,8 €/mois) — hetzner.com/cloud
- ou Scaleway Stardust (~2 €/mois), OVH Starter (~3,5 €/mois)

À la création : choisis **Ubuntu 24.04** (ou Debian 12) et ajoute ta **clé SSH**
(`cat ~/.ssh/id_ed25519.pub` sur ton Mac ; génère-la avec `ssh-keygen -t ed25519` si besoin).
Note l'**adresse IP** du serveur (ex. `203.0.113.10`).

## 2. Un nom de domaine (gratuit)
Le HTTPS automatique exige un nom de domaine. Deux options :
- **DuckDNS (gratuit)** : va sur duckdns.org (login GitHub/Google), crée un sous-domaine
  ex. `tonmuscu.duckdns.org`, mets l'**IP du VPS** dans le champ. C'est tout.
- Ou n'importe quel domaine à toi : ajoute un enregistrement **A** → IP du VPS.

## 3. Installer l'app sur le VPS

Depuis ton Mac :
```bash
rsync -av --exclude .claude /Users/linakaci/trackerz/ root@<IP>:/opt/trackerz/
```

Puis en SSH sur le VPS (`ssh root@<IP>`) :

```bash
# utilisateur dédié sans privilèges
adduser --system --group --home /opt/trackerz muscu
chown -R muscu:muscu /opt/trackerz

# mot de passe de l'app (choisis-le fort, c'est lui qui protège tes données)
read -rsp "Mot de passe de l'app : " MUSCU_PASSWORD && echo
printf '%s' "$MUSCU_PASSWORD" > /opt/trackerz/data/password.txt
unset MUSCU_PASSWORD
chown muscu:muscu /opt/trackerz/data/password.txt && chmod 600 /opt/trackerz/data/password.txt

# service systemd
cat > /etc/systemd/system/muscu.service << 'EOF'
[Unit]
Description=Muscu Tracker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=muscu
WorkingDirectory=/opt/trackerz
ExecStart=/usr/bin/python3 /opt/trackerz/server.py
Environment=PORT=8000
Environment=HOST=127.0.0.1
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/trackerz/data
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now muscu
systemctl status muscu   # doit être "active (running)"
```

> `HOST=127.0.0.1` est important : l'app n'écoute qu'en local, seul Caddy (HTTPS) y accède.

## 4. HTTPS avec Caddy (certificat automatique)

```bash
apt update && apt install -y caddy

cat > /etc/caddy/Caddyfile << 'EOF'
tonmuscu.duckdns.org {
    reverse_proxy 127.0.0.1:8000
}
EOF
systemctl reload caddy
```
(remplace `tonmuscu.duckdns.org` par ton domaine)

Caddy obtient et renouvelle le certificat Let's Encrypt tout seul. Rien d'autre à faire.

## 5. Pare-feu

```bash
apt install -y ufw
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```

## 6. Sur ton téléphone

1. Ouvre `https://tonmuscu.duckdns.org` → écran 🔒 → entre ton mot de passe (retenu sur l'appareil).
2. **Ajouter à l'écran d'accueil** (Safari : Partager → « Sur l'écran d'accueil » / Chrome : ⋮ → « Ajouter à l'écran d'accueil »).

C'est tout : icône 🟧 sur ton écran d'accueil, utilisable au gym en 4G, données sauvegardées sur ton VPS à chaque série.

---

## Mise à jour de l'app
```bash
rsync -av --exclude .claude --exclude data /chemin/vers/trackerz/ root@<IP>:/opt/trackerz/
ssh root@<IP> systemctl restart muscu
```
> ⚠️ **TOUJOURS garder `--exclude data`** : sans lui, le rsync écrase les données du serveur
> (tes séances récentes !) avec la vieille copie du Mac, et casse les droits des fichiers.
> C'est la SEULE commande de mise à jour à utiliser. Le `rsync` de l'installation initiale
> (section 3, sans `--exclude data`) ne sert qu'UNE fois, à la création du serveur.

## Sauvegardes
- Automatique : `data/muscu-data.bak.json` (version précédente) à chaque écriture.
- Recommandé : le bouton **Exporter (JSON)** dans l'app de temps en temps,
  ou depuis ton Mac : `scp root@<IP>:/opt/trackerz/data/muscu-data.json ~/Backups/muscu-$(date +%F).json`

## Sécurité — ce qui est en place
- **HTTPS** partout (Caddy/Let's Encrypt), app inaccessible en clair.
- **Mot de passe** requis pour lire/écrire les données (comparaison à temps constant + délai anti brute-force). Le front (code de l'app) est public, tes données non.
- Serveur applicatif **non exposé** (127.0.0.1 uniquement), utilisateur système **sans privilèges**, pare-feu limité à SSH/80/443.
- Option « au pire » évoquée : tu peux en plus mettre **Tailscale sur le VPS** et fermer 80/443 au public (`ufw deny`), l'app ne serait alors joignable que par tes appareils — tu perds juste l'accès sans VPN.

## Dépannage
- `systemctl status muscu` / `journalctl -u muscu -f` — le serveur applicatif
- `systemctl status caddy` / `journalctl -u caddy -f` — HTTPS (échec de certificat = le domaine ne pointe pas encore vers l'IP)
- L'app affiche « hors-ligne » : vérifie l'URL (https), puis les deux services ci-dessus.
- Changer le mot de passe : édite `data/password.txt` puis `systemctl restart muscu` (l'app redemandera le mot de passe).
