Schedule and booking synchronization repair v29

Live diagnosis:
- The directory entry for dr-ahmed-elkhateeb points to "clicin-admin1".
- Clinic Management for clinic1admin publishes under "clinic1".
- The directory entry has no selected doctor ID.
- Consequently, no publicAvailability document exists under the clinic ID used by the website.

This package adds an editable clinic ID in the website manager, automatically selects the sole published doctor, publishes per-doctor availability immediately, preserves per-day hours, and updates the matching Clinic Management doctor record when website hours are saved.

Follow UPLOAD_v29_AR.txt exactly. No Firebase rules update is required.
