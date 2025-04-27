#!/bin/bash

# Variables
LOCAL_DATA_PATH="/home/olivierb/Documents/crypto/Projects/confluence_bot/data"
REMOTE_PATH="/home/deployer/confluence-bot/data"

# Utilisation de l'alias SSH
echo "🚀 Transfert des données vers la VM..."

# Création du dossier distant si nécessaire
ssh confluence-vm "mkdir -p $REMOTE_PATH"

# Synchronisation du dossier data
rsync -avz --progress $LOCAL_DATA_PATH/ confluence-vm:$REMOTE_PATH/

echo "✅ Transfert terminé!"
