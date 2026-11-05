$ErrorActionPreference = 'Stop'
$addrs = [ordered]@{
  '1'='425 Locust Lane'; '2'='225 East Foster Avenue'; '3'='240 East Prospect Avenue'; '4'='322 Fraternity Row';
  '5'='339 Fraternity Row'; '6'='329 East Prospect Avenue'; '7'='320 South Frasier Street'; '8'='420 East Prospect Avenue';
  '9'='321 East Fairmount Avenue'; '10'='360 North Burrowes Street'; '11'='255 East Fairmount Avenue'; '12'='360 East Hamilton Avenue';
  '13'='508 Locust Lane'; '15'='229 Locust Lane'; '16'='101 North Patterson Street'; '17'='305 East Prospect Avenue';
  '18'='328 East Foster Avenue'; '19'='319 North Burrowes Road'; '20'='403 Locust Lane'; '21'='429 East Hamilton Avenue';
  '22'='408 East Fairmount Avenue'; '23'='338 East Fairmount Avenue'; '24'='501 South Allen Street'; '25'='409 East Fairmount Avenue';
  '26'='200 East Beaver Avenue'; '27'='524 Locust Lane'; '28'='351 East Fairmount Avenue'; '29'='427 East Fairmount Avenue';
  '30'='523 South Allen Street'; '31'='328 East Fairmount Avenue'; '32'='226 East Beaver Avenue'
}
$h = @{ 'User-Agent'='PhatFrats-prototype/1.0 (student project)' }
$out = foreach($k in $addrs.Keys){
  $a = $addrs[$k]
  $r = $null
  foreach($town in 'State College, PA','University Park, PA'){
    $u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=' + [uri]::EscapeDataString("$a, $town")
    $r = Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 30
    Start-Sleep -Milliseconds 1100
    if($r -and $r[0].address.house_number){ break }
  }
  if(-not ($r -and $r[0].address.house_number)){ $cu = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + [uri]::EscapeDataString("$a, State College, PA 16801"); $c = Invoke-RestMethod -Uri $cu -TimeoutSec 30; $m = $c.result.addressMatches; if($m){ $r = @([pscustomobject]@{ lat=$m[0].coordinates.y; lon=$m[0].coordinates.x; name='census'; address=[pscustomobject]@{ house_number='C'; road=$m[0].matchedAddress } }) } }
  if($r){ [pscustomobject]@{ id=$k; addr=$a; lat=[double]$r[0].lat; lon=[double]$r[0].lon; hn=$r[0].address.house_number; road=$r[0].address.road; name=$r[0].name } }
  else { [pscustomobject]@{ id=$k; addr=$a; lat=$null; lon=$null; hn=''; road=''; name='' } }
}
$out | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot 'geo.json')
$out | Format-Table -AutoSize | Out-String -Width 200


