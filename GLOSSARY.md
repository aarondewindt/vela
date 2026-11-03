# Vela Planning

Canonical language for Vela's personal planning domain.

## Availability

**Availability Slot**:
A stable, named-or-unnamed local-time interval in which automatic planning may place work. A slot may carry soft planning guidance and a task-category eligibility policy.
_Avoid_: Window, category slot, reservation

**Availability Template**:
A user-owned, reusable set of availability slots that can supply weekly availability or be copied into date-specific availability.
_Avoid_: Standard hours, availability profile

**Weekly Availability Assignment**:
A weekday's effective-dated association with an availability template. A weekday without an assignment for a date has no default availability.
_Avoid_: Weekly default, standard weekday availability

**Date Availability Override**:
Availability defined specifically for one calendar date, taking precedence over its weekly availability assignment. An override with no slots explicitly makes the date unavailable.
_Avoid_: Work mode, day mode

**Availability Snapshot**:
An independent copy of availability slots applied to a date or date range. Later changes to the source template do not change the snapshot.
_Avoid_: Template assignment, linked copy

**Effective Availability**:
The availability used for automatic planning on a date: its date availability override when present, otherwise the template revision assigned to its weekday for that date, otherwise no availability.
_Avoid_: Standard availability

**Slot Category Policy**:
The task-category eligibility rule attached to an availability slot and enforced during automatic placement. It does not constrain manual draft editing or draft acceptance.
_Avoid_: Category reservation, schedule category

## Planning

**Category Reservation**:
A legacy plan-owned time reservation for a task category. It is not an availability slot or a task category and is being removed from planning behavior and persistence.
_Avoid_: Category slot

**Leisure Target**:
A best-effort amount of availability that automatic planning should devote to leisure tasks or generic leisure blocks. It is not a time reservation.
_Avoid_: Leisure reservation, leisure slot

**Generic Leisure Block**:
A scheduled, taskless period intentionally reserved for unspecified leisure. It is an actual plan block, not unallocated time or a category reservation.
_Avoid_: Leisure reservation, free time
