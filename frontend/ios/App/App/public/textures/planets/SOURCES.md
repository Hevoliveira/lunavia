# Planet textures: sources and usage rights

Every Earth and Moon texture in LUNAVIA is made from NASA imagery. NASA imagery is not
copyrighted in the United States and may be used without permission (NASA Media Usage
Guidelines: https://www.nasa.gov/nasa-brand-center/images-and-media/). NASA is credited
below; no NASA endorsement is implied.

The production files are built by `frontend/scripts/planets/prepare_textures.py`.

| File | Size | Made from | Original source |
|---|---|---|---|
| `moon_color_4k.jpg` | 4096 × 2048 | `lroc_color_poles_8k.tif`, resampled | NASA Scientific Visualization Studio, **CGI Moon Kit** (SVS 4720), colour map from the Lunar Reconnaissance Orbiter Camera (LROC WAC Hapke-normalised mosaic, poles filled from LOLA albedo). NASA/GSFC/Arizona State University. https://svs.gsfc.nasa.gov/4720 |
| `moon_normal_2k.jpg` | 2048 × 1024 | `ldem_16_uint.tif` (16 px/°): surface normals from the elevation, relief × 2, in the local east/north/up frame | NASA SVS **CGI Moon Kit**, elevation from the Lunar Orbiter Laser Altimeter (LOLA). NASA/GSFC/MIT. https://svs.gsfc.nasa.gov/4720 |
| `earth_day_4k.jpg` | 4096 × 2048 | `earth-blue-marble.jpg` | NASA Visible Earth, **Blue Marble** (land surface, shallow water, shaded topography and bathymetry; NASA Earth Observatory / Reto Stöckli). https://visibleearth.nasa.gov/collection/1484/blue-marble |
| `earth_aux_4k.jpg` R | 4096 × 2048 | `water_4k.png` | Land/water mask of NASA Blue Marble |
| `earth_aux_4k.jpg` G | 4096 × 2048 | `earth_lights_2048.png`, warm light only | NASA Visible Earth, **Earth's City Lights** (DMSP/OLS; C. Mayhew & R. Simmon, NASA GSFC). https://visibleearth.nasa.gov/images/55167/earths-city-lights |
| `earth_aux_4k.jpg` B | 4096 × 2048 | `fair_clouds_4k.png` (alpha) | NASA Visible Earth, **Blue Marble clouds** (MODIS) |
| `earth_day_1k.jpg`, `earth_aux_1k.jpg` | 1024 × 512 | the two maps above, resampled | as above (used where the Earth is only a small disc: the lunar sky, the far-side intro) |

**How the source files were obtained.** The NASA servers were not reachable from the build
environment, so the unmodified NASA files were taken from public mirrors:
- CGI Moon Kit `lroc_color_poles_8k.tif` and `ldem_16_uint.tif`: github.com/yigitserce/gcs_code (byte-identical NASA TIFFs);
- Blue Marble 4096 × 2048: github.com/vasturiano/three-globe (`example/img/earth-blue-marble.jpg`);
- Blue Marble water mask and clouds (4096 × 2048): github.com/turban/webgl-earth (`images/water_4k.png`, `images/fair_clouds_4k.png`);
- Earth's City Lights 2048 × 1024: github.com/mrdoob/three.js (`examples/textures/planets/earth_lights_2048.png`).

Visual references (not shipped, not used as textures): NASA's own photographs in
github.com/nasa/NASA-3D-Resources (Apollo views of the full Moon and of the Earth).

The previous textures (`earth_atmos_2048.jpg`, `earth_normal_2048.jpg`, `earth_specular_2048.jpg`,
`earth_clouds_1024.png`, `moon_1024.jpg`, from the three.js examples) are no longer used and were removed.

**How the cloud channel is shown.** The NASA cloud map in `earth_aux_4k.jpg` B stores most cloud
systems faintly (median 0.04, 90th percentile 0.53). Both Earth renderers (the globe and the launch
film's Earth) read it through one cover curve (`CLOUD_COVER_GLSL` in
`components/planets/planetMaterials.js`), so the real fronts, storm belts and tropical clusters
show as opaque cloud. The image data itself is unchanged, and no cloud is generated.

**The Moon's fine detail** close to the surface (lunar orbit, descent, EVA) is a procedural crater
field generated in code (not NASA data), used only below the NASA maps' resolution (2.7 km per
texel). The global colour and relief remain the NASA maps above.
