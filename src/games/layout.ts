// BLOCKFALL well geometry, shared by the games that morph into / out of it.
// Interior columns 2..12 (11 wide), rows 1..21; walls at cols 1 and 13, floor at row 22.
export const WELL = { left: 2, right: 12, top: 1, bottom: 21, floor: 22 } as const;
export const WELL_W = WELL.right - WELL.left + 1;
export const WELL_H = WELL.bottom - WELL.top + 1;

// Piece colours (index 1..7 = I O T S Z J L). Original palette.
export const PIECE_COLORS = ['', '#46e0ff', '#ffd23f', '#c15cff', '#5cff7a', '#ff5c6c', '#4a7dff', '#ff9f43'];

// ALIEN RAID formation (top-left of each invader, in cells, before sway offset).
export const FORM = { cols: 7, rows: 4, x0: 1.6, dx: 1.6, y0: 2.5, dy: 1.4 } as const;
export const slotX = (i: number) => FORM.x0 + i * FORM.dx;
export const slotY = (j: number) => FORM.y0 + j * FORM.dy;

// ALIEN RAID shields: three bunkers, 3×2 cells each.
export const SHIELD_CELLS: { c: number; r: number }[] = [];
for (const c0 of [2, 6, 10]) for (let r = 18; r <= 19; r++) for (let c = c0; c < c0 + 3; c++) SHIELD_CELLS.push({ c, r });

/** Player row for ALIEN RAID / PADDLE (top-left y of the ship). */
export const SHIP_ROW = 22;
