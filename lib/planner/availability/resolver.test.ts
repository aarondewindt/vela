import {
  availabilitySnapshotHash,
  resolveEffectiveAvailability,
  type EffectiveAvailabilityInput,
} from './resolver';

const templateSlot = (overrides: Record<string, unknown> = {}) => ({
  id: 'revision-slot-1',
  logicalSlotId: 'logical-slot-1',
  position: 0,
  startMinute: 9 * 60,
  endMinute: 12 * 60,
  name: 'Deep work',
  guidance: 'Prefer the hardest task first.',
  policy: { mode: 'ALLOW_ONLY' as const, categories: ['WORK' as const] },
  ...overrides,
});

const input = (
  overrides: Partial<EffectiveAvailabilityInput> = {}
): EffectiveAvailabilityInput => ({
  date: '2026-11-03',
  timezonePeriods: [{ effectiveDate: '2020-01-01', timezone: 'Europe/Amsterdam' }],
  weeklyAssignments: [
    { id: 'assignment-1', weekday: 2, effectiveDate: '2020-01-01', templateId: 'template-1' },
  ],
  templates: [
    {
      id: 'template-1',
      revisions: [
        {
          id: 'revision-1',
          effectiveDate: '2020-01-01',
          name: 'Weekday',
          slots: [templateSlot()],
        },
      ],
    },
  ],
  dateOverrides: [],
  ...overrides,
});

describe('resolveEffectiveAvailability', () => {
  it('resolves ordered weekly metadata and instants through historical assignment, revision and timezone', () => {
    const result = resolveEffectiveAvailability(
      input({
        date: '2026-11-04',
        timezonePeriods: [
          { effectiveDate: '2020-01-01', timezone: 'UTC' },
          { effectiveDate: '2026-11-04', timezone: 'America/New_York' },
        ],
        weeklyAssignments: [
          {
            id: 'old-assignment',
            weekday: 3,
            effectiveDate: '2020-01-01',
            templateId: null,
          },
          {
            id: 'new-assignment',
            weekday: 3,
            effectiveDate: '2026-11-04',
            templateId: 'template-1',
          },
        ],
        templates: [
          {
            id: 'template-1',
            revisions: [
              {
                id: 'revision-old',
                effectiveDate: '2020-01-01',
                name: 'Old name',
                slots: [templateSlot({ name: 'Old slot' })],
              },
              {
                id: 'revision-new',
                effectiveDate: '2026-11-04',
                name: 'New name',
                slots: [
                  templateSlot({
                    id: 'revision-slot-2',
                    name: 'New slot',
                    position: 1,
                    startMinute: 12 * 60,
                    endMinute: 13 * 60,
                  }),
                  templateSlot({ position: 0 }),
                ],
              },
            ],
          },
        ],
      })
    );

    expect(result).toMatchObject({
      schemaVersion: 1,
      date: '2026-11-04',
      timezone: 'America/New_York',
      origin: 'WEEKLY_ASSIGNMENT',
      assignmentId: 'new-assignment',
      templateId: 'template-1',
      templateRevisionId: 'revision-new',
      templateName: 'New name',
    });
    expect(result.slots.map((slot) => slot.name)).toEqual(['Deep work', 'New slot']);
    expect(result.slots[0]).toMatchObject({
      id: 'logical-slot-1',
      logicalSlotId: 'logical-slot-1',
      templateRevisionSlotId: 'revision-slot-1',
      startsAt: '2026-11-04T14:00:00.000Z',
      endsAt: '2026-11-04T17:00:00.000Z',
    });
  });

  it('lets a date snapshot shadow weekly availability, including an explicit empty override', () => {
    const snapshot = resolveEffectiveAvailability(
      input({
        dateOverrides: [
          {
            id: 'override-1',
            date: '2026-11-03',
            slots: [
              {
                id: 'date-slot-1',
                position: 0,
                startMinute: 13 * 60,
                endMinute: 14 * 60,
                name: 'Appointment buffer',
                guidance: null,
                policy: { mode: 'ALL', categories: [] },
                sourceTemplateId: 'template-1',
                sourceTemplateRevisionId: 'revision-1',
                sourceLogicalSlotId: 'logical-slot-1',
              },
            ],
          },
        ],
      })
    );
    expect(snapshot).toMatchObject({ origin: 'DATE_OVERRIDE', dateOverrideId: 'override-1' });
    expect(snapshot.slots).toEqual([
      expect.objectContaining({
        id: 'date-slot-1',
        logicalSlotId: null,
        sourceLogicalSlotId: 'logical-slot-1',
        startMinute: 780,
      }),
    ]);

    expect(
      resolveEffectiveAvailability(
        input({ dateOverrides: [{ id: 'override-empty', date: '2026-11-03', slots: [] }] })
      )
    ).toMatchObject({ origin: 'DATE_OVERRIDE', dateOverrideId: 'override-empty', slots: [] });
  });

  it('returns no availability for an unassigned weekday', () => {
    expect(
      resolveEffectiveAvailability(
        input({
          weeklyAssignments: [
            { id: 'unassign', weekday: 2, effectiveDate: '2026-01-01', templateId: null },
          ],
        })
      )
    ).toMatchObject({ origin: 'UNASSIGNED_WEEKDAY', slots: [] });
  });

  it('retains adjacent slots and rejects overlaps while leaving gaps unavailable', () => {
    const adjacent = resolveEffectiveAvailability(
      input({
        templates: [
          {
            id: 'template-1',
            revisions: [
              {
                id: 'revision-1',
                effectiveDate: '2020-01-01',
                name: 'Weekday',
                slots: [
                  templateSlot({ endMinute: 10 * 60 }),
                  templateSlot({
                    id: 'revision-slot-2',
                    logicalSlotId: 'logical-slot-2',
                    position: 1,
                    startMinute: 10 * 60,
                    endMinute: 11 * 60,
                  }),
                  templateSlot({
                    id: 'revision-slot-3',
                    logicalSlotId: 'logical-slot-3',
                    position: 2,
                    startMinute: 12 * 60,
                    endMinute: 13 * 60,
                  }),
                ],
              },
            ],
          },
        ],
      })
    );
    expect(adjacent.slots.map(({ startMinute, endMinute }) => [startMinute, endMinute])).toEqual([
      [540, 600],
      [600, 660],
      [720, 780],
    ]);

    expect(() =>
      resolveEffectiveAvailability(
        input({
          templates: [
            {
              id: 'template-1',
              revisions: [
                {
                  id: 'revision-1',
                  effectiveDate: '2020-01-01',
                  name: 'Overlap',
                  slots: [
                    templateSlot({ endMinute: 10 * 60 }),
                    templateSlot({
                      id: 'revision-slot-2',
                      logicalSlotId: 'logical-slot-2',
                      position: 1,
                      startMinute: 9 * 60 + 30,
                      endMinute: 11 * 60,
                    }),
                  ],
                },
              ],
            },
          ],
        })
      )
    ).toThrow('overlap');
  });

  it.each([
    ['2026-03-29', 23],
    ['2026-10-25', 25],
  ])('resolves a full local day on %s to its actual %i-hour duration', (date, hours) => {
    const result = resolveEffectiveAvailability(
      input({
        date,
        weeklyAssignments: [
          { id: 'assignment-1', weekday: 0, effectiveDate: '2020-01-01', templateId: 'template-1' },
        ],
        templates: [
          {
            id: 'template-1',
            revisions: [
              {
                id: 'revision-1',
                effectiveDate: '2020-01-01',
                name: 'Full day',
                slots: [templateSlot({ startMinute: 0, endMinute: 1440 })],
              },
            ],
          },
        ],
      })
    );
    expect(
      (new Date(result.slots[0].endsAt).getTime() - new Date(result.slots[0].startsAt).getTime()) /
        3_600_000
    ).toBe(hours);
  });

  it.each([
    ['2026-03-29', 150, 'does not exist'],
    ['2026-10-25', 150, 'occurs twice'],
  ])('rejects invalid DST boundary %s minute %i', (date, minute, message) => {
    expect(() =>
      resolveEffectiveAvailability(
        input({
          date,
          weeklyAssignments: [
            {
              id: 'assignment-1',
              weekday: 0,
              effectiveDate: '2020-01-01',
              templateId: 'template-1',
            },
          ],
          templates: [
            {
              id: 'template-1',
              revisions: [
                {
                  id: 'revision-1',
                  effectiveDate: '2020-01-01',
                  name: 'DST boundary',
                  slots: [templateSlot({ startMinute: minute, endMinute: 4 * 60 })],
                },
              ],
            },
          ],
        })
      )
    ).toThrow(message);
  });
});

describe('availabilitySnapshotHash', () => {
  it.each([
    ['identity', { logicalSlotId: 'logical-slot-2' }],
    ['time', { endMinute: 12 * 60 + 1 }],
    ['name', { name: 'Meetings' }],
    ['guidance', { guidance: 'Prefer shallow tasks.' }],
    ['policy', { policy: { mode: 'EXCLUDE', categories: ['LEISURE'] } }],
  ])('changes when slot %s changes', (_label, change) => {
    const before = resolveEffectiveAvailability(input());
    const changed = input();
    changed.templates[0].revisions[0].slots[0] = templateSlot(change);
    expect(availabilitySnapshotHash(resolveEffectiveAvailability(changed))).not.toBe(
      availabilitySnapshotHash(before)
    );
  });

  it('changes with timezone but ignores unrelated templates', () => {
    const before = resolveEffectiveAvailability(input());
    const timezone = input({
      timezonePeriods: [{ effectiveDate: '2020-01-01', timezone: 'Europe/London' }],
    });
    expect(availabilitySnapshotHash(resolveEffectiveAvailability(timezone))).not.toBe(
      availabilitySnapshotHash(before)
    );

    const unrelated = input();
    unrelated.templates.push({
      id: 'unused',
      revisions: [
        { id: 'unused-revision', effectiveDate: '2020-01-01', name: 'Unused', slots: [] },
      ],
    });
    expect(availabilitySnapshotHash(resolveEffectiveAvailability(unrelated))).toBe(
      availabilitySnapshotHash(before)
    );
  });

  it('ignores assignment and immutable revision row identities when resolved availability is unchanged', () => {
    const before = resolveEffectiveAvailability(input());
    const noOpRevision = input({
      weeklyAssignments: [
        {
          id: 'replacement-assignment-row',
          weekday: 2,
          effectiveDate: '2026-11-03',
          templateId: 'template-1',
        },
      ],
      templates: [
        {
          id: 'template-1',
          revisions: [
            {
              id: 'replacement-revision-row',
              effectiveDate: '2026-11-03',
              name: 'Weekday',
              slots: [templateSlot({ id: 'replacement-revision-slot-row' })],
            },
          ],
        },
      ],
    });
    expect(availabilitySnapshotHash(resolveEffectiveAvailability(noOpRevision))).toBe(
      availabilitySnapshotHash(before)
    );
  });
});
