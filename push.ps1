cd c:\Users\witma\Documents\TRAE\railway
$env:Path = "C:\Program Files\Git\bin;$env:Path"
git add .
git commit -m "Fix: Filter only approved games in renderGames"
git push -u origin main --force
