# MORPH

Retro games that morph into each other right under your hands. Hit a game's milestone and it starts blending into the next one: rules, graphics, music and controls all change while you keep playing.

**▶ Play:** https://depthark.github.io/morphing-game/

## The chain

| Game | Milestone | Morph into the next game |
|---|---|---|
| SNAKE | length 10 | Apples turn into cherries and chompers that shrink you, while a maze grows around you |
| CHOMPER | eat 2 ghosts | SPACE drops bombs, walls turn into bricks and pillars, ghosts can be blown up |
| BOMBER | destroy every enemy | Bricks line up as an invader formation, pillars become shields, gravity pulls you down, bombs become shots |
| ALIEN RAID | shoot all but the last 5 | Shots bounce, invaders weld into the CPU paddle, your ship flattens into a paddle |
| PADDLE | 5 points vs. the CPU | Gravity seeps into the ball, SPACE = flap, pipes stream in |
| FLAPPER | pass 8 pipes | Pipes crumble into blocks that fall into a rising well |
| BLOCKFALL | 4 lines | The falling piece comes alive as a snake and the stack turns into crumbs. Next loop, faster |

Score and 3 lives are shared across every game. The bar at the top fills toward the milestone and drains during the morph.

## Controls

- **Keyboard:** arrows / WASD, SPACE action (bomb, shoot, flap, hard drop), ↑ / X rotate, Z rotate back, P pause, M sound
- **Touch:** swipe = direction, tap = action (rotate in Blockfall, swipe ↓ = drop), drag = paddle / ship

## Development

```bash
bun install
bun run dev      # http://localhost:5173
bun run test     # simulates the whole chain (2 loops) + maze checks
bun run build
```

Debug: `?debug` enables the **N** key (jump to the morph / finish it), `?start=bomber` starts at a given game.

Every push to `main` deploys to GitHub Pages (`.github/workflows/static.yml`).
