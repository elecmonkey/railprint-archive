# Test fixtures

The `.osm.pbf` files are generated from `mini.opl` and committed so most tests do not need osmium. Regenerate after editing the OPL:

```sh
osmium cat mini.opl -o mini.osm.pbf --overwrite
osmium cat mini.opl --output-header osmosis_replication_sequence_number=1 --output-header osmosis_replication_timestamp=2026-01-01T00:00:00Z --output-header osmosis_replication_base_url=http://localhost/replication -o replicated.osm.pbf --overwrite
```
