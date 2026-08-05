# Architecture Notes

Known, intentional scope boundaries of this prototype — documented so they read as deliberate decisions rather than gaps or bugs if questioned.

## Single professor login sees all courses

This prototype uses a single professor login (`prof_dtai`) with visibility into all seeded courses for demo purposes. Production would have per-professor accounts, each seeing only their own timetable_slots via `professor_identifier` matching their login.

Because of this, the Professor calendar view can show classes belonging to other seeded courses (e.g. BDC, SOM) alongside DTAI's own. Each such class card is labeled with its real course and professor name (e.g. "BDC · Prof Arunabha Mukhopadhyay") so this reads as intentional multi-course visibility for one demo account, not a data-integrity bug.
