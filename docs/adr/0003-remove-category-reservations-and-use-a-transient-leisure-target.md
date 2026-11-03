# Remove category reservations and use a transient leisure target

Vela removes category reservations from current behavior and persistence instead of carrying a permanent compatibility model. The local database is test-only and has no open Planner drafts, so losing historical reservation rows is acceptable; accepted schedule blocks and task state remain intact.

Task and theme categories remain descriptive metadata and availability slots enforce normalized task-category policies during automatic placement. The leisure goal becomes a best-effort generation target: Vela prefers eligible leisure tasks and fills any remaining target with explicit generic leisure blocks. These are actual taskless schedule blocks, not hidden reservations or indistinguishable unallocated time.

A generic leisure block is a taskless `DailyBlock` with category `LEISURE`, a normal title and an ordinary manual or Planner source. It occupies schedule time, obeys the maximum leisure-block duration when generated and may be distributed across eligible slots. Generated blocks are replaceable during regeneration; manually created or edited blocks retain manual protection. Done or skipped outcomes affect only the block, never task state. Existing leisure tasks and generic leisure blocks count toward the leisure target; meals, breaks and REST blocks do not.
