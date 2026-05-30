# tier-3 `migration graph` — hand-drawn layout mockups

Design conversation artifact. These are **hand-drawn**, not generated — the point
is to settle the visual language before coding the renderer. Hashes/names are real,
taken from `prototype/gallery.md` (the fixture topologies).

Carries forward the device from the original
`migration-graph-display-scenarios.md` draft: **a direction arrow in the edge's own
lane** (`↑` forward, `↓` rollback).

## The model

Contracts are **nodes**, migrations are **edges**. A migration is never a property
of a node; it is always the connector between two contracts.

## Layout rules (variant B + lane arrows)

1. **Root(s) at the bottom, tip(s) at the top.** Forward edges point **up** (`↑`),
   rollbacks point **down** (`↓`).
2. **A contract is one `○ <hash>` row**, appearing exactly once in the whole graph.
   `◆` marks the contract the DB is currently at.
3. **A migration is one edge row** — every migration on its own row (vertical space
   is cheap, horizontal is not).
4. **The arrow sits in the migration's own lane**, in the lane's second cell:
   `│↑` / `│↓`. Every other (pass-through) lane on that row is a bare `│ `. The
   arrow therefore does double duty:
   - **direction** — `↑` forward, `↓` rollback (no separate arc lane needed);
   - **lane** — in a fan, only the lane that owns the label carries the arrow, so
     the three `│ │ │` rows of a wide fan are unambiguous in monochrome.
5. **Convergence** (a contract with N parents) stacks N edge rows directly below it,
   each carrying its `↑` in its own lane down to its parent. A long edge is a lane
   that runs several rows before reaching its node — still one continuous lane.
6. **Divergence** (a contract with N children) fans N lanes upward; each outgoing
   edge is labelled in its own lane.
7. **Adjacency, not direction, decides whether an edge is drawn.** An edge whose
   target is its layout-neighbour is **just a direction glyph** — `↑` to the node
   directly above, `↓` to the node directly below. This is symmetric: a simple
   rollback (and every 2-node cycle) is a plain `↓`, exactly mirroring forward `↑`.
   No connector, no arc.
8. **Only a *node-skipping* edge gets a routed connector** (see § routed arcs) —
   one whose target is not its neighbour, so a bare glyph would point at the wrong
   node. This is where forward and backward edges *do* diverge, and the asymmetry is
   inherent: a forward edge runs with the layout grain, so a non-adjacent one is
   absorbed into the **branch/merge spine** (`├ ┐ ┴`) — it *is* the topology; a
   backward edge runs against the grain, so a non-adjacent one has nowhere in the
   spine to live and is drawn as an **explicit arc**.
9. **Self-edges** are also their own edge row — `⟲` is the direction glyph (a loop),
   name and `hash → hash` data intact; never collapsed onto the node row.

### Routed arcs (node-skipping backward edges only)

Adjacent rollbacks are plain `↓` (rule 7). When a rollback skips over node rows to
reach a non-adjacent target, its lane is drawn as an explicit arc — in the **same
solid box-drawing as forward lanes**, **originating from its source node** (a tee off
the node row, the box-drawing-consistent way to attach an edge):

- `○─╮` — the arc tees off its **source node's row** into a back-lane.
- `│` — arc body (solid; the downward routing + landing arrowhead mark it as
  backward — no dashing needed, since direction is already unambiguous).
- `│↓` — the rollback's direction glyph sits **after its own lane's line** on its
  label row, identical in form to a forward edge's `│↑` (line then arrow); only the
  lane it occupies differs.
- `◂╯` / `◂─╯` — the arc turns in and points into its target node (the `─` bridges
  any freed lane between the arc and the node).

Overlapping back-arcs take separate adjacent back-lanes, allocated left-to-right;
where a later arc tees off a node whose row an earlier arc's lane crosses, the
crossing is `┼`.

The `from → to` data column is always present and authoritative; the gutter +
arrow are the visual aid.

---

## linear

```
○   a94b7b4
│↑  add_posts            ef9de27 → a94b7b4
○   ef9de27
│↑  init                 ∅ → ef9de27
○   ∅
```

## rollback

Both rollbacks target their layout-neighbour (the node directly below), so they are
plain `↓` rows — no arc. This mirrors forward `↑` exactly (same as `pure cycle`).

```
○   3ee5d20
│↑  add_bio              73e3abe → 3ee5d20
│↓  rollback_bio         3ee5d20 → 73e3abe
○   73e3abe
│↑  add_phone            ef9de27 → 73e3abe
│↓  rollback_phone       73e3abe → ef9de27
○   ef9de27
│↑  init                 ∅ → ef9de27
○   ∅
```

## diamond

`merge_bob` is the long edge — its lane (col 1) runs from the top fan down past
`73e3abe` to its parent `6656a6e`, but it's one continuous lane carrying one `↑`.

```
○     3b2d98d
├─┐
│↑│   merge_alice        73e3abe → 3b2d98d
│ │↑  merge_bob          6656a6e → 3b2d98d
○ │   73e3abe
│↑│   alice_add_phone    ef9de27 → 73e3abe
│ ○   6656a6e
│ │↑  bob_add_avatar     ef9de27 → 6656a6e
├─┘
○   ef9de27
│↑  init                 ∅ → ef9de27
○   ∅
```

## sequential-diamonds

`3b2d98d` is the convergence of the lower diamond **and** the divergence of the
upper one — one row, both jobs.

```
○     cd5c15b
├─┐
│↑│   merge_2a           0276f92 → cd5c15b
│ │↑  merge_2b           a94b7b4 → cd5c15b
○ │   0276f92
│↑│   add_comments       3b2d98d → 0276f92
│ ○   a94b7b4
│ │↑  add_posts_branch   3b2d98d → a94b7b4
├─┘
○     3b2d98d
├─┐
│↑│   merge_1a           73e3abe → 3b2d98d
│ │↑  merge_1b           6656a6e → 3b2d98d
○ │   73e3abe
│↑│   alice_add_phone    ef9de27 → 73e3abe
│ ○   6656a6e
│ │↑  bob_add_avatar     ef9de27 → 6656a6e
├─┘
○   ef9de27
│↑  init                 ∅ → ef9de27
○   ∅
```

## converging-branches (3-way fan — the resolved stress case)

The arrow-in-lane carries the three merge rows and three add rows with no colour.

```
○       3116048
├─┬─╮
│↑│ │   merge_phone      73e3abe → 3116048
│ │↑│   merge_posts      a94b7b4 → 3116048
│ │ │↑  merge_avatar     6656a6e → 3116048
○ │ │   73e3abe
│↑│ │   add_phone        ef9de27 → 73e3abe
│ ○ │   a94b7b4
│ │↑│   add_posts        ef9de27 → a94b7b4
│ │ ○   6656a6e
│ │ │↑  add_avatar       ef9de27 → 6656a6e
├─┴─╯
○   ef9de27
│↑  init                 ∅ → ef9de27
○   ∅
```

## cross-link — nonlinear forward history

`A→B→C`, `A→D→E`, plus a cross edge `B→E`. `B` diverges (to `C` and `E`); `E`
converges (from `B` and `D`). The cross edge is just a forward lane that spans rows
and **joins at the shared node** — exactly like the diamond's long edge. It does not
break the model: the lane allocator joins any lanes that want the same node, so
`B→E`'s lane (col 1) joins the `C`-lane at `B`, and both child-lanes of `A` join at
the root.

```
○        C
│↑       B→C             B → C
│ ○      E
│ ├─╮
│ │↑│    B→E             B → E
│ │ │↑   D→E             D → E
├─┘ │
○   │    B
│↑  │    A→B             A → B
│   ○    D
│   │↑   A→D             A → D
├───┘
○        A
```

## kitchen-sink — divergence + an adjacent rollback cycle (no arc)

`ef9de27` diverges into a long branch (col 0, with a `0276f92 ⇄ e9bd4aa` cycle at
its tip) and a short branch (col 1). The cycle's rollback targets its neighbour
`0276f92`, so it is a plain `↓` (rule 7) — ordering the forward arrival above the
rollback departure keeps it adjacent. The short branch's tip `bdc08a6` sits where it
topologically belongs — two edges above the divergence — with col 0 running up past
it alone (unequal branch lengths, like `git log --graph`).

```
○      e9bd4aa
│↑     kitchen_sink      0276f92 → e9bd4aa
│↓     rollback          e9bd4aa → 0276f92
○      0276f92
│↑     add_comments      a94b7b4 → 0276f92
○      a94b7b4
│↑     add_posts         c81f321 → a94b7b4
○      c81f321
│↑     change_default    b1858bc → c81f321
○      b1858bc
│↑     email_default     73e3abe → b1858bc
○      73e3abe
│↑     add_phone         ef9de27 → 73e3abe
│ ○    bdc08a6
│ │↑   migration         cc527d2 → bdc08a6
│ ○    cc527d2
│ │↑   widen_email       ef9de27 → cc527d2
├─┘
○      ef9de27
│↑     init              ∅ → ef9de27
○      ∅
```

## routed arcs — node-skipping rollbacks (the only case with arcs)

### skip-rollback — two overlapping back-arcs

Here the rollbacks genuinely jump over a node, so a plain `↓` would point at the
wrong neighbour — these are the cases that need a routed arc. `rollback_to_phone`
(col 1, `a94b7b4 → 73e3abe`, skipping `3ee5d20`) and `rollback_to_init` (col 2,
`3ee5d20 → ef9de27`, skipping `73e3abe`) overlap in row-span, so they take adjacent
back-lanes; each tees off its source node and lands across the gutter into its target.

```
○─╮       a94b7b4
│ │↓      rollback_to_phone   a94b7b4 → 73e3abe
│↑│       add_posts           3ee5d20 → a94b7b4
○─┼─╮     3ee5d20
│ │ │↓    rollback_to_init    3ee5d20 → ef9de27
│↑│ │     add_bio             73e3abe → 3ee5d20
○◂╯ │     73e3abe
│↑  │     add_phone           ef9de27 → 73e3abe
○◂──╯     ef9de27
│↑        init                ∅ → ef9de27
○         ∅
```

## disjoint forest (the real world is messy)

Two unrelated components, stacked with a blank separator. The second component's
root is **not** `∅` — its parent was pruned (no `○ ∅` beneath it).

```
○   bbbbbbb
│↑  app_next             aaaaaaa → bbbbbbb
○   aaaaaaa
│↑  app_init             ∅ → aaaaaaa
○   ∅

○   ddddddd
│↑  other_root           ccccccc → ddddddd
○   ccccccc              (root: parent pruned)
```

## dangling parent

```
○   fffffff
│↑  continue             eeeeeee → fffffff
○   eeeeeee
│↑  after_prune          ddddddd → eeeeeee
○   ddddddd              (root: parent pruned)
```

## self-edge

A no-op migration whose result equals its input. It's still an edge with a name
and ops, so it gets its own row — `⟲` is just the direction glyph (a loop, neither
up nor down), and the `hash → hash` data column makes the self-loop self-evident.

```
○   bbbbbbb
│↑  next                 aaaaaaa → bbbbbbb
○   aaaaaaa
│⟲  noop                 aaaaaaa → aaaaaaa
│↑  init                 ∅ → aaaaaaa
○   ∅
```

## pure cycle

Forward `↑` and rollback `↓` between two contracts, nothing else.

```
○   bbbbbbb
│↑  forward              aaaaaaa → bbbbbbb
│↓  rollback             bbbbbbb → aaaaaaa
○   aaaaaaa
```
