$ErrorActionPreference = 'Stop'
$S=40.7870; $N=40.8000; $W=-77.8735; $E=-77.8470
$bbox = "$S,$W,$N,$E"
$cache = Join-Path $PSScriptRoot 'osm.json'
if(-not (Test-Path $cache)){
  $q = @"
[out:json][timeout:90];
(
  way["highway"]($bbox);
  way["building"]($bbox);
  way["leisure"~"^(park|pitch|garden)$"]($bbox);
  way["landuse"~"^(grass|recreation_ground)$"]($bbox);
);
out tags geom($bbox);
"@
  $resp = $null
  foreach($ep in 'https://overpass.private.coffee/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass-api.de/api/interpreter'){
    try { $resp = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $ep -Body @{ data = $q } -Headers @{ 'User-Agent'='PhatFrats-prototype/1.0' } -TimeoutSec 180; "via $ep"; break } catch { "fail $ep : $($_.Exception.Message)"; Start-Sleep 5 }
  }
  [IO.File]::WriteAllText($cache, $resp.Content)
}
$j = Get-Content -Raw $cache | ConvertFrom-Json
$lat0 = ($S+$N)/2
$k = 1000 / (($E-$W) * [Math]::Cos($lat0*[Math]::PI/180))
$H = [Math]::Round(($N-$S)*$k)
function P($lat,$lon){ $x = ($lon-$W)*[Math]::Cos($lat0*[Math]::PI/180)*$k; $y = ($N-$lat)*$k; return @([Math]::Round($x,1),[Math]::Round($y,1)) }
function PathOf($geom,$close){
  $sb = New-Object Text.StringBuilder
  $first = $true; $px=$null; $py=$null
  foreach($g in $geom){
    if($null -eq $g){ continue }
    $p = P $g.lat $g.lon
    if($first){ [void]$sb.Append("M$($p[0]) $($p[1])"); $first=$false; $px=$p[0]; $py=$p[1] }
    elseif([Math]::Abs($p[0]-$px)+[Math]::Abs($p[1]-$py) -ge 1.2){ [void]$sb.Append("L$($p[0]) $($p[1])"); $px=$p[0]; $py=$p[1] }
  }
  if($close -and -not $first){ [void]$sb.Append('Z') }
  $sb.ToString()
}
$groups = @{ bldg=New-Object Text.StringBuilder; green=New-Object Text.StringBuilder; foot=New-Object Text.StringBuilder; svc=New-Object Text.StringBuilder; res=New-Object Text.StringBuilder; major=New-Object Text.StringBuilder }
$named = @{}
$landmarks = @()
$want = 'Old Main','Hetzel Union Building','HUB-Robeson Center','Pattee Library','Paterno Library','Rec Hall','Schwab Auditorium','Willard Building','Sackett Building','Osmond Laboratory','Recreation Building'
foreach($el in $j.elements){
  if($el.type -ne 'way' -or -not $el.geometry){ continue }
  $t = $el.tags
  if($t.building){
    $d = PathOf $el.geometry $true; if($d.Length -gt 12){ [void]$groups.bldg.Append($d) }
    if($t.name -and ($want -contains $t.name)){
      $xs = $el.geometry | Where-Object { $_ } | ForEach-Object { (P $_.lat $_.lon) }
      $cx=0;$cy=0;$cnt=0; for($i=0;$i -lt $xs.Count;$i+=2){ $cx+=$xs[$i];$cy+=$xs[$i+1];$cnt++ }
      $landmarks += [pscustomobject]@{ name=$t.name; x=[Math]::Round($cx/$cnt,1); y=[Math]::Round($cy/$cnt,1) }
    }
    continue
  }
  if($t.leisure -or $t.landuse){ [void]$groups.green.Append((PathOf $el.geometry $true)); continue }
  $hw = $t.highway
  if(-not $hw){ continue }
  $d = PathOf $el.geometry $false
  if($hw -match '^(footway|path|pedestrian|steps|cycleway)$'){ [void]$groups.foot.Append($d) }
  elseif($hw -eq 'service'){ [void]$groups.svc.Append($d) }
  elseif($hw -match '^(primary|secondary|tertiary|primary_link|secondary_link)$'){ [void]$groups.major.Append($d) }
  elseif($hw -match '^(residential|unclassified|living_street)$'){ [void]$groups.res.Append($d) }
  else { continue }
  if($t.name -and $hw -notmatch 'footway|path|steps|cycleway'){
    $pts = @($el.geometry | Where-Object { $_ } | ForEach-Object { ,(P $_.lat $_.lon) })
    $len = 0; for($i=1;$i -lt $pts.Count;$i++){ $len += [Math]::Sqrt([Math]::Pow($pts[$i][0]-$pts[$i-1][0],2)+[Math]::Pow($pts[$i][1]-$pts[$i-1][1],2)) }
    if(-not $named[$t.name] -or $named[$t.name].len -lt $len){
      # label at the point halfway along the way, rotated to that segment
      $half=$len/2; $acc=0; $lx=0;$ly=0;$ang=0
      for($i=1;$i -lt $pts.Count;$i++){
        $dx=$pts[$i][0]-$pts[$i-1][0]; $dy=$pts[$i][1]-$pts[$i-1][1]; $sl=[Math]::Sqrt($dx*$dx+$dy*$dy)
        if($acc+$sl -ge $half -and $sl -gt 0){ $f=($half-$acc)/$sl; $lx=$pts[$i-1][0]+$dx*$f; $ly=$pts[$i-1][1]+$dy*$f; $ang=[Math]::Atan2($dy,$dx)*180/[Math]::PI; break }
        $acc+=$sl
      }
      if($ang -gt 90){ $ang -= 180 } elseif($ang -lt -90){ $ang += 180 }
      $named[$t.name] = [pscustomobject]@{ name=$t.name; len=[Math]::Round($len); x=[Math]::Round($lx,1); y=[Math]::Round($ly,1); a=[Math]::Round($ang,1); major=($hw -match 'primary|secondary|tertiary') }
    }
  }
}
$geo = Get-Content -Raw (Join-Path $PSScriptRoot 'geo.json') | ConvertFrom-Json
$pins = $geo | ForEach-Object { $p = P ([double]$_.lat) ([double]$_.lon); [pscustomobject]@{ id=[int]$_.id; x=$p[0]; y=$p[1] } }
$res = [pscustomobject]@{
  H=$H
  paths=[pscustomobject]@{ bldg=$groups.bldg.ToString(); green=$groups.green.ToString(); foot=$groups.foot.ToString(); svc=$groups.svc.ToString(); res=$groups.res.ToString(); major=$groups.major.ToString() }
  labels=@($named.Values | Where-Object { $_.len -gt 60 } | Sort-Object len -Descending)
  landmarks=$landmarks
  pins=$pins
  extra=[pscustomobject]@{ stadium=(P 40.8122 -77.8561) }
}
$res | ConvertTo-Json -Depth 5 -Compress | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot 'mapdata.json')
"H=$H"
$res.paths.PSObject.Properties | ForEach-Object { "$($_.Name): $($_.Value.Length) chars" }
"labels: " + (($res.labels | Select-Object -First 40 | ForEach-Object { "$($_.name)($($_.len))" }) -join ', ')
"landmarks: " + (($landmarks | ForEach-Object { "$($_.name)@$($_.x),$($_.y)" }) -join '; ')
"pins: " + (($pins | ForEach-Object { "$($_.id):$($_.x),$($_.y)" }) -join ' ')


