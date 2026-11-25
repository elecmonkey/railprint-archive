# Elecmonkey's Railprint

> [!NOTE]
> This is an archive repository. The project has moved to https://github.com/elecmonkey/railprint.

Elecmonkey's railway footprint: the lines I have travelled, drawn on a globe from OpenStreetMap geometry. See it at https://rail.elecmonkey.com.

## Licences

The code in this repository is released under the [MIT License](LICENSE).

The data and bundled assets come from third parties under their own terms:

| What                                                                                   | Source                                                                                                                                                                                        | Licence                                                    |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Railway geometry, stations and OSM references in `data/catalog/` and `data/release/`   | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors                                                                                                                       | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| Rivers and lakes in `packages/basemap/assets/`, and the land mask of the terrain tiles | Made with [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)                                                                                                               | Public domain                                              |
| Elevation and hillshade of the terrain tiles (`packages/tiles`)                        | NOAA National Centers for Environmental Information. 2022: [ETOPO 2022 Global Relief Model](https://www.ncei.noaa.gov/products/etopo-global-relief-model). https://doi.org/10.25921/fd45-gt74 | Public domain                                              |
| Noto Sans SC, cut down to the characters used and bundled with the web app             | © Adobe, with Reserved Font Name 'Source'                                                                                                                                                     | [SIL Open Font License 1.1](https://openfontlicense.org/)  |
| Geist font, bundled with the web app                                                   | © The Geist Project Authors                                                                                                                                                                   | [SIL Open Font License 1.1](https://openfontlicense.org/)  |
| React and React DOM, bundled with the web app                                          | © Meta Platforms, Inc. and affiliates                                                                                                                                                         | MIT                                                        |
| d3-geo and d3-array, bundled with the web app                                          | © Mike Bostock                                                                                                                                                                                | ISC                                                        |

Data derived from OpenStreetMap remains under the ODbL, not the MIT License. Every declared source, with its attribution text, is listed in `data/sources.json`.
