# GridScout DC Presentation - GIF Capture Guide

## Setup
1. Open GridScout at https://hyder.me/grid (password: GRIDSCOUT)
2. Use Chrome at 1440x900 or similar widescreen resolution
3. Record with **Cmd+Shift+5** (macOS screen recording, select area)

## Convert to GIF
```bash
# Convert .mov to GIF (install: brew install ffmpeg gifsicle)
ffmpeg -i recording.mov -vf "fps=12,scale=800:-1:flags=lanczos" -palet_use=1 output.gif
gifsicle -O3 --lossy=80 output.gif -o optimized.gif
```

## GIF Captures Needed (4 total)

### 1. `demo-map.gif` → Slide 3 (Interactive Map)
**Page**: /grid/map
**Actions** (15-20 seconds):
1. Start zoomed out showing the full US with clustered markers
2. Slowly zoom into Virginia/North Carolina corridor
3. Click on a high-scored site marker to show the popup
4. Toggle the transmission line overlay on
5. Brief pause showing lines + markers together

### 2. `demo-score.gif` → Slide 4 (DC Readiness Score)
**Page**: /grid/site?id=[pick a site with score 80+]
**Actions** (12-15 seconds):
1. Show the site header with score prominently visible
2. Scroll down slowly through the score breakdown section
3. Show each factor's individual score bar
4. Pause on the satellite map showing the site location

### 3. `demo-search.gif` → Slide 7 (Search & Filter)
**Page**: /grid/search
**Actions** (15-20 seconds):
1. Start with all sites visible in the table
2. Select a state filter (e.g., Virginia)
3. Set minimum score to 70
4. Show results updating in real-time
5. Sort by DC Score descending
6. Click into the top result

### 4. `demo-detail.gif` → Slide 8 (Site Detail)
**Page**: /grid/site?id=[pick a brownfield site with good data]
**Actions** (15-20 seconds):
1. Show the full site detail page header
2. Scroll through power infrastructure section
3. Scroll through fiber connectivity data
4. Scroll to the satellite map at the bottom
5. Zoom into the satellite view showing the actual site

## After Capture

Place optimized GIFs in `decks/gridscout/assets/` then update the HTML:

Replace each `<div class="demo-placeholder">` block with:
```html
<img src="assets/demo-map.gif" alt="Interactive Map Demo">
```

Target file size: under 3MB per GIF for fast loading.
