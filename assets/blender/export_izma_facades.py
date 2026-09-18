"""Export an appearance revision only after unchanged ground/physics is proved."""
import bpy
from pathlib import Path
root=Path(__file__).resolve().parent
name=Path(bpy.data.filepath).stem
assert name in ['izma-districts','izma-neighbourhoods']
path=root/('export_izma_neighbourhoods.py' if name=='izma-neighbourhoods' else 'export_izma_districts.py')
scope={'__file__':str(path),'_APPEARANCE_ONLY':True}
exec(compile(path.read_text(),str(path),'exec'),scope)
print(scope['result'],flush=True)
