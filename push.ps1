cd c:\Users\witma\Documents\TRAE\railway
$env:Path = "C:\Program Files\Git\bin;$env:Path"
git init
git add .
git commit -m "Update game platform"
git remote add origin https://github.com/NOPE-BDB/nope.git
git branch -M main
git push -u origin main --force
