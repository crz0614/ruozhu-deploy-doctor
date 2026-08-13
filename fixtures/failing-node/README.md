# Intentional failing repository fixture

This minimal repository intentionally imports a missing module. `npm test` must exit non-zero with a real module-resolution error. Deploy Doctor uses it for deterministic end-to-end failure reproduction; it is not presented as a customer repository or production incident.
