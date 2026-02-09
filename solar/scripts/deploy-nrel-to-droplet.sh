#!/bin/bash
# Deploy NREL Panel-Segmentation model to DigitalOcean droplet
# Droplet: root@104.131.105.89 (8 CPU, 15GB RAM, Ubuntu 25.04)
#
# Usage:
#   # Step 1: Set up droplet environment (run once)
#   bash scripts/deploy-nrel-to-droplet.sh setup
#
#   # Step 2: Sync satellite images to droplet (run after fetch-satellite-images.py)
#   bash scripts/deploy-nrel-to-droplet.sh sync
#
#   # Step 3: Run classification on droplet
#   bash scripts/deploy-nrel-to-droplet.sh classify
#
#   # Step 4: Check progress
#   bash scripts/deploy-nrel-to-droplet.sh status
#
#   # All-in-one (setup + sync + classify)
#   bash scripts/deploy-nrel-to-droplet.sh all

set -e

DROPLET="root@104.131.105.89"
REMOTE_DIR="/root/solar-nrel"
LOCAL_IMAGE_DIR="data/satellite_images"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }

setup_droplet() {
    log "Setting up NREL Panel-Segmentation on droplet..."

    ssh $DROPLET bash -s << 'SETUP_EOF'
set -e

echo "=== Installing system dependencies ==="
apt-get update -qq
apt-get install -y -qq git-lfs libgl1-mesa-glx libglib2.0-0 screen wget 2>/dev/null || true
git lfs install 2>/dev/null || true

# Create project directory
mkdir -p /root/solar-nrel/images
mkdir -p /root/solar-nrel/results

# Install Miniconda if not present (provides Python 3.10)
if [ ! -d /root/miniconda3 ]; then
    echo "=== Installing Miniconda ==="
    wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/miniconda.sh
    bash /tmp/miniconda.sh -b -p /root/miniconda3
    rm /tmp/miniconda.sh
    echo "Miniconda installed"
else
    echo "Miniconda already installed"
fi

export PATH="/root/miniconda3/bin:$PATH"

# Accept conda ToS (required for recent Miniconda versions)
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main 2>/dev/null || true
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r 2>/dev/null || true

# Create conda env with Python 3.10 if not exists
if ! conda env list | grep -q "nrel"; then
    echo "=== Creating conda env 'nrel' with Python 3.10 ==="
    conda create -y -n nrel python=3.10
fi

# Activate and install deps
NREL_PYTHON="/root/miniconda3/envs/nrel/bin/python"
NREL_PIP="/root/miniconda3/envs/nrel/bin/pip"

echo "=== Installing NREL Panel-Segmentation ==="
$NREL_PIP install --upgrade pip wheel setuptools

# Install TensorFlow CPU
$NREL_PIP install tensorflow==2.13.0

# Install Panel-Segmentation from GitHub (includes model weights via LFS)
$NREL_PIP install "git+https://github.com/NREL/Panel-Segmentation.git@master#egg=panel-segmentation"

# Install MMCV for SOL-Searcher model (optional)
$NREL_PIP install "git+https://github.com/open-mmlab/mmcv.git@v2.1.0" || echo "MMCV install failed (optional, not needed for mount classification)"

# Install python-dotenv
$NREL_PIP install python-dotenv

echo "=== Verifying installation ==="
$NREL_PYTHON -c "
from panel_segmentation.panel_detection import PanelDetection
print('Panel-Segmentation loaded successfully!')
import os
models_dir = os.path.join(os.path.dirname(__import__('panel_segmentation').__file__), 'models')
for f in sorted(os.listdir(models_dir)):
    if f.endswith(('.h5', '.pth')):
        size = os.path.getsize(os.path.join(models_dir, f))
        if size < 1000:
            print(f'  WARNING: {f} is only {size} bytes (LFS pointer, not actual model!)')
        else:
            print(f'  OK: {f} ({size/1024/1024:.1f} MB)')
"

echo ""
echo "=== Setup complete! ==="
echo "Python: $($NREL_PYTHON --version)"
echo "TensorFlow: $($NREL_PYTHON -c 'import tensorflow; print(tensorflow.__version__)')"
SETUP_EOF

    log "Setup complete!"
}

sync_images() {
    local count=$(find "$PROJECT_DIR/$LOCAL_IMAGE_DIR" -maxdepth 1 -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
    log "Syncing $count satellite images to droplet..."

    if [ "$count" -eq "0" ]; then
        warn "No images found in $PROJECT_DIR/$LOCAL_IMAGE_DIR/"
        warn "Run fetch-satellite-images.py first"
        exit 1
    fi

    # Use rsync for efficient transfer (only new files)
    rsync -avz --progress \
        --include="*.png" --exclude="*" \
        "$PROJECT_DIR/$LOCAL_IMAGE_DIR/" \
        "$DROPLET:$REMOTE_DIR/images/"

    log "Sync complete!"

    # Also copy the classify script and env
    log "Copying classify script and credentials..."
    scp "$SCRIPT_DIR/classify-mount-type.py" "$DROPLET:$REMOTE_DIR/classify-mount-type.py"

    # Create a minimal .env.local on the droplet
    ssh $DROPLET bash -s << ENV_EOF
cat > /root/solar-nrel/.env.local << 'INNEREOF'
$(grep -E "^(SUPABASE_|NEXT_PUBLIC_SUPABASE_|GOOGLE_MAPS_)" "$PROJECT_DIR/.env.local")
INNEREOF
echo "Env file created with $(wc -l < /root/solar-nrel/.env.local) lines"
ENV_EOF

    log "Files synced!"
}

run_classify() {
    log "Starting classification on droplet (this will take ~17 hours for 30K images)..."

    ssh $DROPLET bash -s << 'CLASSIFY_EOF'
cd /root/solar-nrel

# Count images
IMG_COUNT=$(ls -1 images/*.png 2>/dev/null | wc -l)
echo "Images available: $IMG_COUNT"

if [ "$IMG_COUNT" -eq "0" ]; then
    echo "ERROR: No images found. Run 'deploy sync' first."
    exit 1
fi

# Update script to look for images in local dir
sed -i 's|IMAGE_DIR = Path("data/satellite_images")|IMAGE_DIR = Path("/root/solar-nrel/images")|' classify-mount-type.py
sed -i 's|env_path = Path(__file__).parent.parent / ".env.local"|env_path = Path("/root/solar-nrel/.env.local")|' classify-mount-type.py

# Run in screen session so it persists after SSH disconnect
if screen -list | grep -q "nrel"; then
    echo "Classification already running! Use 'deploy status' to check."
    exit 0
fi

echo "Starting classification in screen session 'nrel'..."
screen -dmS nrel bash -c '
    /root/miniconda3/envs/nrel/bin/python -u /root/solar-nrel/classify-mount-type.py \
        --device cpu \
        --confidence 0.5 \
        2>&1 | tee /root/solar-nrel/results/classify.log
    echo "DONE at $(date)" >> /root/solar-nrel/results/classify.log
'

echo ""
echo "Classification started in background screen session 'nrel'"
echo "Monitor with: ssh root@104.131.105.89 'tail -f /root/solar-nrel/results/classify.log'"
echo "Or attach:    ssh root@104.131.105.89 -t 'screen -r nrel'"
CLASSIFY_EOF

    log "Classification started on droplet!"
    log ""
    log "Monitor progress:"
    log "  bash scripts/deploy-nrel-to-droplet.sh status"
    log "  ssh root@104.131.105.89 'tail -f /root/solar-nrel/results/classify.log'"
}

check_status() {
    log "Checking classification status..."

    ssh $DROPLET bash -s << 'STATUS_EOF'
echo "=== Droplet Status ==="
echo "CPU: $(nproc) cores"
echo "RAM: $(free -h | awk '/Mem:/{print $3 "/" $2}')"
echo "Disk: $(df -h / | awk 'NR==2{print $3 "/" $2 " (" $5 " used)"}')"
echo ""

# Check screen session
if screen -list 2>/dev/null | grep -q "nrel"; then
    echo "Classification: RUNNING"
else
    echo "Classification: NOT RUNNING"
fi

# Check log
if [ -f /root/solar-nrel/results/classify.log ]; then
    echo ""
    echo "=== Last 20 lines of log ==="
    tail -20 /root/solar-nrel/results/classify.log
else
    echo "No log file yet"
fi

# Count results
IMG_COUNT=$(ls -1 /root/solar-nrel/images/*.png 2>/dev/null | wc -l)
echo ""
echo "Images on droplet: $IMG_COUNT"
STATUS_EOF
}

# Main
case "${1:-help}" in
    setup)
        setup_droplet
        ;;
    sync)
        sync_images
        ;;
    classify)
        run_classify
        ;;
    status)
        check_status
        ;;
    all)
        setup_droplet
        sync_images
        run_classify
        ;;
    *)
        echo "Usage: $0 {setup|sync|classify|status|all}"
        echo ""
        echo "  setup    - Install Python 3.10, NREL model, and deps on droplet"
        echo "  sync     - Rsync satellite images and scripts to droplet"
        echo "  classify - Start classification in background screen session"
        echo "  status   - Check classification progress"
        echo "  all      - Run setup + sync + classify"
        ;;
esac
