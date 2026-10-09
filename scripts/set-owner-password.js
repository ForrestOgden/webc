#!/usr/bin/env node
'use strict';
// Run with: node scripts/set-owner-password.js
// Password is prompted privately, never placed on the command line or checked into source.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const input = process.stdin;
const output = process.stdout;
if (!input.isTTY) { console.error('Please run in an interactive terminal.');process.exit(1); }
output.write('Create a private owner password (12–256 characters): ');
let password = '';
input.setRawMode(true);input.resume();input.setEncoding('utf8');
input.on('data',c=>{
  for(const ch of c){
    if(ch==='\u0003')process.exit(1);
    if(ch==='\r'||ch==='\n'){
      input.setRawMode(false);input.pause();output.write('\n');
      if(password.length<12||password.length>256){console.error('Password must be 12–256 characters.');process.exitCode=1;return;}
      const salt=crypto.randomBytes(16).toString('hex');
      const hash=crypto.scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');
      const envPath=path.resolve(__dirname,'../.env');
      let lines='';try{lines=fs.readFileSync(envPath,'utf8');}catch{}
      lines=lines.replace(/^PRIVATE_FILTER_PASSWORD_HASH=.*\r?\n?/gm,'').trimEnd();
      const next=(lines?lines+'\n':'')+'PRIVATE_FILTER_PASSWORD_HASH='+salt+'$'+hash+'\n';
      fs.writeFileSync(envPath,next,{encoding:'utf8',mode:0o600});
      try{fs.chmodSync(envPath,0o600);}catch{}
      password='';console.log('Private password configured in .env. Restart the server.');
      return;
    }
    if(ch==='\u007f'){password=password.slice(0,-1);}else if(ch>=' '){password+=ch;}
  }
});
