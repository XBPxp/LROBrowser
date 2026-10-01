// Genshin-inspired dark pickup cards, with RO blue accents and existing icons.
// Kept outside the upstream bundle for review when the snapshot changes.
export const ITEM_OBTAIN_CSS = `
/* LastRO item-obtain placement and typography */
:host {
  position: fixed !important;
  top: var(--loot-top, 0px) !important;
  left: var(--loot-left, 0px) !important;
  right: auto !important;
  width: var(--loot-width, 304px);
  height: var(--loot-panel-height, auto);
  max-width: none;
  transform: scale(var(--loot-scale, .75));
  transform-origin: top left;
  pointer-events: none;
}
#ItemObtain .content,
#ItemObtain .loot-row {
  transform: translateX(0);
  opacity: 1;
}
#ItemObtain .loot-row { clip-path: inset(0 0 0 0); }
#ItemObtain .content.is-entering {
  animation: lastro-loot-fade 120ms ease-out both;
}
#ItemObtain .loot-row.is-entering {
  animation: lastro-loot-enter 240ms ease-out both;
}
#ItemObtain .content.is-closing .loot-heading {
  animation: lastro-loot-heading-exit 400ms linear both;
}
#ItemObtain .loot-row.is-leaving {
  z-index: 2;
  animation: lastro-loot-exit 400ms cubic-bezier(.4,0,.6,1) both;
}
#ItemObtain .content.is-paused,
#ItemObtain .content.is-paused .loot-row,
#ItemObtain .content.is-paused .loot-heading {
  animation-play-state: paused !important;
}
#ItemObtain {
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-family: Arial, 'Microsoft YaHei', 'MiSans', 'LastRO Glyph Fallback', sans-serif;
  font-size: var(--loot-font, 14px);
  font-size-adjust: none;
  line-height: 1.4;
  color: #edf5ff;
  pointer-events: none;
}
#ItemObtain .content {
  height: auto;
  overflow: visible;
  padding: 0;
  border: 0;
  border-radius: 0;
  white-space: normal;
  line-height: inherit;
  pointer-events: none;
}
#ItemObtain .loot-list {
  display: flex;
  flex-direction: column;
  gap: var(--loot-gap, 6px);
  /* Keep the final exiting card visible while its flow space collapses. */
  min-height: var(--loot-row-height, 56px);
  pointer-events: none;
}
#ItemObtain .loot-preview {
  margin-top: var(--loot-gap, 6px);
  height: calc(var(--loot-row-height, 56px) / 2);
  overflow: hidden;
  opacity: .4;
  mask-image: linear-gradient(#000 30%, transparent);
  pointer-events: none;
}
#ItemObtain .loot-preview .loot-row {
  animation: none;
  transform: translateY(-25%);
}
#ItemObtain .loot-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 var(--loot-gap, 6px);
  color: #aacdf3;
  font-size: var(--loot-small-font, 11px);
  font-weight: 500;
  letter-spacing: 2px;
  text-shadow: 0 1px 3px #0009;
}
#ItemObtain .loot-heading::before {
  content: '';
  width: 5px;
  height: 5px;
  border: 1px solid #8bb7ec;
  transform: rotate(45deg);
}
#ItemObtain .loot-heading::after {
  content: '';
  width: 54px;
  height: 1px;
  background: linear-gradient(90deg, #8bb7ec66, transparent);
}
#ItemObtain .loot-row {
  position: relative;
  flex-shrink: 0;
  margin-bottom: 0;
  display: flex;
  align-items: center;
  gap: var(--loot-gap, 6px);
  box-sizing: border-box;
  height: var(--loot-row-height, 56px);
  padding: var(--loot-padding, 5px) var(--loot-inline-padding, 12px);
  border: 0;
  border-left: 2px solid #79a8e3;
  border-radius: 2px;
  background: linear-gradient(90deg, #242e3feb, #242e3fbf 75%, #242e3f52);
  box-shadow: inset 0 1px #c4e0ff14, 0 4px 16px #00000012;
}
#ItemObtain .loot-icon {
  display: grid;
  place-items: center;
  flex: 0 0 var(--loot-icon, 34px);
  width: var(--loot-icon, 34px);
  height: var(--loot-icon, 34px);
  background: linear-gradient(145deg, #b7d3f01c, #b7d3f006);
  border: 1px solid #b5d5f61f;
  border-radius: 3px;
  box-sizing: border-box;
}
#ItemObtain .loot-icon img {
  display: block;
  width: var(--loot-image-size, 24px);
  height: var(--loot-image-size, 24px);
  vertical-align: baseline;
  image-rendering: pixelated;
  filter: drop-shadow(0 1px 2px #0005);
}
#ItemObtain .loot-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--loot-font, 14px);
  font-weight: 500;
  line-height: var(--loot-line-height, 19px);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  text-shadow: 0 1px 2px #0007;
}
#ItemObtain .loot-count {
  display: flex;
  align-items: baseline;
  gap: 5px;
  flex: 0 0 auto;
  color: #afd1ff;
  font-family: Arial, sans-serif;
  font-size: var(--loot-count-font, 15px);
  font-variant-numeric: tabular-nums;
  line-height: var(--loot-line-height, 19px);
  text-shadow: 0 1px 2px #0007;
}
#ItemObtain .loot-times { font-size: var(--loot-small-font, 11px); opacity: .7; }
@keyframes lastro-loot-enter {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes lastro-loot-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes lastro-loot-exit {
  from { opacity: 1; transform: translateX(0); margin-bottom: 0; }
  70% { opacity: 1; }
  to {
    opacity: 0;
    transform: translateX(calc(100% + var(--loot-edge, 20px)));
    margin-bottom: calc(0px - var(--loot-row-height, 56px) - var(--loot-gap, 6px));
  }
}
@keyframes lastro-loot-heading-exit {
  from, 70% { opacity: 1; }
  to { opacity: 0; }
}
`;
