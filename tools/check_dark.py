from PIL import Image
import numpy as np
hs=Image.open(r'G:\sh\local-earth\data\public\dem\N25E102-hillshade.png').convert('RGBA')
a=np.asarray(hs)
rgb=a[:,:,:3]; al=a[:,:,3]
dark=((rgb.max(axis=2)<20)).sum()
print('hillshade dark px', dark, 'of', rgb.shape[0]*rgb.shape[1], 'alpha min/max', al.min(), al.max())
for p in [r'G:\sh\local-earth\data\public\tiles\blue-marble\5\25\8.jpg', r'G:\sh\local-earth\data\public\tiles\blue-marble\5\25\9.jpg']:
    im=np.asarray(Image.open(p).convert('RGB'))
    d=(im.max(axis=2)<20).sum()
    print(p.split('\\')[-2:], 'dark px', d, 'of', im.shape[0]*im.shape[1], 'min', im.min())
