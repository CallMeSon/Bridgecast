# Builds fixtures/sample-anim.pptx (stand-in for the hand-made fixture of the native-slideshow plan).
# Needs python-pptx and ffmpeg: python3 -m venv v && v/bin/pip install python-pptx && v/bin/python scripts/make-sample-anim.py fixtures/sample-anim.pptx
import sys, subprocess, tempfile, os
VIDEO = os.path.join(tempfile.mkdtemp(), 'v.mp4')
from pptx import Presentation
from pptx.util import Inches, Pt
from lxml import etree
out = sys.argv[1]
NS='http://schemas.openxmlformats.org/presentationml/2006/main'
def effect(ctn, spid, node, delay='0'):
    # appear effect
    return f'''<p:par><p:cTn id="{ctn}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>
<p:par><p:cTn id="{ctn+1}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
<p:par><p:cTn id="{ctn+2}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" nodeType="{node}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
<p:set><p:cBhvr><p:cTn id="{ctn+3}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>
</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>'''
def click_group(i, spid):
    return effect(i, spid, 'clickEffect')
def after_group(i, spid, prev_inner=None):
    # afterEffect inside previous click group: simplified (separate inner par after the click effect)
    return f'''<p:par><p:cTn id="{i}" fill="hold"><p:stCondLst><p:cond delay="500"/></p:stCondLst><p:childTnLst>
<p:par><p:cTn id="{i+1}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
<p:set><p:cBhvr><p:cTn id="{i+2}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>
</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>'''
def timing(groups):
    return etree.fromstring(f'''<p:timing xmlns:p="{NS}"><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>
<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>{groups}</p:childTnLst></p:cTn>
<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>
<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>''')
prs = Presentation(); prs.slide_width=Inches(13.333); prs.slide_height=Inches(7.5)
blank = prs.slide_layouts[6]
def tb(s, text, x, y, font='Calibri'):
    t = s.shapes.add_textbox(Inches(x), Inches(y), Inches(8), Inches(1)); t.text_frame.text=text
    for p in t.text_frame.paragraphs:
        for r in p.runs: r.font.size=Pt(36); r.font.name=font
    return t
# 1: three click bullets
s=prs.slides.add_slide(blank); tb(s,'On click bullets',1,0.3)
ids=[tb(s,f'Bullet {i}',1,1.5+i*1.3).shape_id for i in (1,2,3)]
s.notes_slide.notes_text_frame.text='Notes of slide 1'
s._element.append(timing(''.join(click_group(3+i*10, sp) for i,sp in enumerate(ids))))
# 2: click + after previous
s=prs.slides.add_slide(blank); tb(s,'After previous',1,0.3)
a=tb(s,'First (click)',1,2).shape_id; b=tb(s,'Second (after previous)',1,4).shape_id
g=effect(3,a,'clickEffect')
# put afterEffect in the same click group: insert before closing of inner par list
g=g.replace('</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>', after_group(20,b)+'</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>',1) if False else g
s._element.append(timing(g+''))
# put after effect as next sibling inside the click group
t=s._element.find(f'{{{NS}}}timing')
grp=etree.XPath('//p:cTn[@nodeType="mainSeq"]/p:childTnLst/p:par/p:cTn/p:childTnLst', namespaces={'p':NS})(t)[0]
grp.append(etree.fromstring(after_group(20,b).replace('<p:par>',f'<p:par xmlns:p="{NS}">',1)))
# 3: transition fade slide
s=prs.slides.add_slide(blank); tb(s,'Transition slide',1,0.3)
s._element.insert(list(s._element).index(s._element.find(f'{{{NS}}}clrMapOvr'))+1 if s._element.find(f'{{{NS}}}clrMapOvr') is not None else len(s._element), etree.fromstring(f'<p:transition xmlns:p="{NS}" spd="med"><p:fade/></p:transition>'))
# 4: hidden
s=prs.slides.add_slide(blank); tb(s,'Hidden slide',1,0.3); s._element.set('show','0')
# 5: video with sound
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','lavfi','-i','testsrc=size=640x360:rate=25','-f','lavfi','-i','sine=frequency=440','-t','6','-pix_fmt','yuv420p','-c:v','libx264','-c:a','aac',VIDEO],check=True)
s=prs.slides.add_slide(blank); tb(s,'Video with sound',1,0.3)
mv=s.shapes.add_movie(VIDEO,Inches(3),Inches(1.5),Inches(6),Inches(3.4),mime_type='video/mp4')
mvid=mv.shape_id
s._element.append(etree.fromstring(f'''<p:timing xmlns:p="{NS}"><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="5" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="6" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="{mvid}"/></p:tgtEl></p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'''))
# 6: plain
s=prs.slides.add_slide(blank); tb(s,'Plain slide, Segoe UI','1','1' and 1,0.3) if False else tb(s,'Plain slide (Segoe UI Light)',1,0.3,'Segoe UI Light')
prs.save(out)
