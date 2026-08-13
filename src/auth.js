import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt=promisify(scryptCallback);

export async function hashPassword(password){if(typeof password!=="string"||password.length<12)throw new Error("Password must be at least 12 characters");const salt=randomBytes(16);const derived=await scrypt(password,salt,64);return`scrypt:${salt.toString("base64")}:${derived.toString("base64")}`}
export async function verifyPassword(password,encoded){const[,saltText,hashText]=String(encoded).split(":");if(!saltText||!hashText)return false;const expected=Buffer.from(hashText,"base64");const actual=await scrypt(password,Buffer.from(saltText,"base64"),expected.length);return timingSafeEqual(expected,actual)}
export function newSession(){return randomBytes(32).toString("base64url")}
export function parseCookies(header=""){return Object.fromEntries(header.split(";").map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf("=");return[decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}))}
export function sessionCookie(id,maxAge=604800){return`dd_session=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV==="production"?"; Secure":""}`}
