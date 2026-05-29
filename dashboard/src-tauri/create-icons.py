#!/usr/bin/env python3
"""
Generates a minimal icon set for Tauri.
Run once: python3 src-tauri/create-icons.py
"""
import struct, zlib, os

def create_png(size: int, r: int, g: int, b: int) -> bytes:
    """Create a solid-color RGBA PNG of given size (Tauri requires RGBA)."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

    # Color type 6 = RGBA (not 2 = RGB)
    ihdr_data = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    # Build raw image data: filter byte (0) + RGBA per pixel per row
    raw = b''.join(b'\x00' + bytes([r, g, b, 255]) * size for _ in range(size))
    idat_data = zlib.compress(raw, 9)

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr_data)
        + chunk(b'IDAT', idat_data)
        + chunk(b'IEND', b'')
    )

# Dashboard brand color — indigo #4f46e5
R, G, B = 0x4f, 0x46, 0xe5

icons_dir = os.path.join(os.path.dirname(__file__), 'icons')
os.makedirs(icons_dir, exist_ok=True)

for size in [32, 128, 256, 512]:
    path = os.path.join(icons_dir, f'icon.png' if size == 512 else f'{size}x{size}.png')
    with open(path, 'wb') as f:
        f.write(create_png(size, R, G, B))
    print(f'  created {path}')

# Tauri also expects these specific filenames
import shutil
shutil.copy(
    os.path.join(icons_dir, '128x128.png'),
    os.path.join(icons_dir, '128x128@2x.png'),
)
print('Done. Icons written to src-tauri/icons/')
