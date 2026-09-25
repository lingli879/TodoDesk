from PIL import Image, ImageDraw

SIZE = 256
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([8, 8, 248, 248], radius=56, fill='#2FA98C')
# 白色对勾（圆头线段）
d.line([(70, 132), (116, 178)], fill='white', width=26)
d.line([(116, 178), (190, 92)], fill='white', width=26)
d.ellipse([57, 119, 83, 145], fill='white')
d.ellipse([103, 165, 129, 191], fill='white')
d.ellipse([177, 79, 203, 105], fill='white')

img.save('build/icon.png')
img.save('build/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.resize((32, 32), Image.LANCZOS).save('build/tray.png')
print('ok')
