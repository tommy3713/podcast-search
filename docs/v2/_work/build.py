"""Build ../prototype.html from prototype.tpl.html by inlining the JSON data files."""
import os
here = os.path.dirname(os.path.abspath(__file__))
read = lambda n: open(os.path.join(here, n), encoding='utf-8').read()
html = read('prototype.tpl.html')
for key, name in (('__PARAS__', 'ep686_paras.json'), ('__OLDER_EPS__', 'older_eps.json')):
    html = html.replace(key, read(name).replace('</', '<\\/'))
open(os.path.join(here, '..', 'prototype.html'), 'w', encoding='utf-8').write(html)
