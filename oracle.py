# Generates command lines with only quoting constructs and no expansions, and has real bash (eval "set -- LINE") split them.
import random, subprocess, sys, json
seed=int(sys.argv[1]); N=int(sys.argv[2]); random.seed(seed)
PLAIN=list('abcxyz019-./=:,_@%+ \t')+['#',' ',' ','  ','a','b','file','-f']
ANSI=[r'\n',r'\t',r'\\',r"\'",r'\"',r'\a',r'\e',r'\b',r'\f',r'\r',r'\v',r'\?',r'\x41',r'\x7e',r'\x4',r'\x20',r'\101',r'\040',r'\7',r'\17',r'\u00e9',r'\u263a',r'\U0001F600',r'\u41',r'\cb',r'\cz',r'\q',r'\x',r'\u',r'\8','é','日']
def unit():
    r=random.random()
    if r<.35: return random.choice(PLAIN)
    if r<.5: return "'"+''.join(random.choice(PLAIN+['"','\\','$',' ','é']) for _ in range(random.randint(0,4)))+"'"
    if r<.7: return '"'+''.join(random.choice(PLAIN+["'",'\\\\','\\"','\\$','\\`','\\a','\\\n','\\ ','é','\\']) for _ in range(random.randint(0,4)))+'"'
    if r<.82: return '\\'+random.choice(list(' \t"\'\\#;&|<>()$`*?[]{}~!ab0é')+['\n'])
    if r<.95: return "$'"+''.join(random.choice(ANSI+PLAIN[:12]) for _ in range(random.randint(0,4)))+"'"
    return random.choice(["'","\"","$'",'\\'])   # likely unterminated
cases=[]
for _ in range(N):
    s=''.join(unit() for _ in range(random.randint(1,7)))
    if '\x00' in s: continue
    cases.append(s)
drv=r'''export LC_ALL=C.UTF-8; set -f
while IFS= read -r -d '' s; do
  ( eval "set -- $s" 2>/dev/null || exit 9; printf 'OK\0'; for a in "$@"; do printf '%s\0' "$a"; done ) 2>/dev/null
  printf '@RC=%s\n@@REC\n' "$?"
done'''
inp=b''.join(c.encode()+b'\0' for c in cases)
p=subprocess.run(['bash','-c',drv],input=inp,capture_output=True)
outs=p.stdout.split(b'\n@@REC\n')[:-1]
assert len(outs)==len(cases),(len(outs),len(cases))
with open(sys.argv[3],'w') as f:
    for c,o in zip(cases,outs):
        o=o.decode('utf-8','replace')
        k=o.rindex('@RC='); rc=o[k+4:]; body=o[:k]
        if rc!='0' or not body.startswith('OK\0'): f.write(json.dumps({'s':c,'ok':False})+'\n')
        else:
            args=body[3:].split('\0')[:-1]
            f.write(json.dumps({'s':c,'ok':True,'argv':args})+'\n')
