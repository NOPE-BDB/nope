cd c:\Users\witma\Documents\TRAE\railway
$env:Path = "C:\Program Files\Git\bin;$env:Path"
git add .
git commit -m "Fix: Add file:// protocol check and safe tags access"
git push -u origin main --force
