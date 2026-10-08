# Notes

## Prima commands

```sh
yarn prisma migrate dev --name <name_here>
yarn prisma generate
yarn prisma studio
```

## Task sizes

The task `size` field is an integer with these user-facing labels:

| Value | Label | Intended scale |
| ---: | --- | --- |
| 0 | Unknown | No size estimate yet |
| 1 | XS | Less than 15 minutes |
| 2 | S | About 30–60 minutes |
| 3 | M | A few hours of work |
| 4 | L | Main focus for a day; may take longer than one day |
| 5 | XL | Multi-day work; schedule across multiple sessions until complete |

These descriptions are planning guidance rather than enforced durations. The integer values are persisted in the database; application interfaces should show the labels instead of the raw values.
