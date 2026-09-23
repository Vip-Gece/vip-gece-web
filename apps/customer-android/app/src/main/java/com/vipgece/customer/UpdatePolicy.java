package com.vipgece.customer;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.InterruptedIOException;

/** Public, signed metadata is separate from customer API credentials. */
final class UpdatePolicy {
    static final String MANIFEST_PATH="/public/downloads/vip-gece-customer-clean-latest.json";
    static final long MAX_APK=100L*1024*1024;
    private UpdatePolicy() {}

    static URI origin(String value) {
        URI u=URI.create(value);
        String host=u.getHost();
        if(!"https".equals(u.getScheme())||host==null||!host.matches("(?i)[a-z0-9][a-z0-9.-]*\\.[a-z]{2,}")
            ||u.getPort()!=-1||u.getUserInfo()!=null||u.getRawQuery()!=null||u.getRawFragment()!=null
            ||!(u.getRawPath()==null||u.getRawPath().isEmpty())||host.endsWith(".localhost")||host.endsWith(".local"))
            throw new SecurityException("Invalid update origin");
        return u;
    }
    static URI apkUrl(URI origin,String path) {
        if(!path.matches("/public/downloads/vip-gece-customer-clean-[a-zA-Z0-9._-]+\\.apk")||path.contains(".."))
            throw new SecurityException("Invalid APK path");
        return origin.resolve(path);
    }
    static byte[] verify(String payload,String signature,String pem) throws Exception {
        if(payload.length()>24000||signature.length()>2048)throw new SecurityException("Oversized manifest");
        byte[] bytes=Base64.getDecoder().decode(payload);
        String encoded=pem.replace("-----BEGIN PUBLIC KEY-----","").replace("-----END PUBLIC KEY-----","").replaceAll("\\s","");
        RSAPublicKey key=(RSAPublicKey)KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(encoded)));
        if(key.getModulus().bitLength()<2048)throw new SecurityException("Weak signing key");
        Signature verifier=Signature.getInstance("SHA256withRSA"); verifier.initVerify(key); verifier.update(bytes);
        if(!verifier.verify(Base64.getDecoder().decode(signature)))throw new SecurityException("Invalid manifest signature");
        return bytes;
    }
    static void metadata(String packageName,long version,long size,String hash,String certificate,long issued,long expires,long now,int minSdk,int deviceSdk) {
        if(!"com.vipgece.customer".equals(packageName)||version<1||version>Integer.MAX_VALUE||size<1||size>MAX_APK
            ||!hash.matches("[a-f0-9]{64}")||!certificate.matches("[a-f0-9]{64}")
            ||issued<1||issued>now+300||expires<=now||expires<=issued||expires-issued>90L*86400
            ||minSdk<26||minSdk>deviceSdk)throw new SecurityException("Invalid update metadata");
    }
    static void version(long candidate,long current,long highestSeen) {
        if(candidate<=current||candidate<highestSeen)throw new SecurityException("Update rollback rejected");
    }
    // A null output verifies an existing private candidate without making another copy.
    static void verifyApkBytes(InputStream in,OutputStream out,long expectedSize,String expectedHash) throws Exception {
        if(expectedSize<1||expectedSize>MAX_APK||!expectedHash.matches("[a-f0-9]{64}"))throw new SecurityException("Invalid APK limits");
        MessageDigest digest=MessageDigest.getInstance("SHA-256");long count=0;byte[] block=new byte[65536];int size;
        while((size=in.read(block))!=-1) {
            if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();
            count+=size;if(count>expectedSize)throw new SecurityException("APK size exceeded");
            digest.update(block,0,size);if(out!=null)out.write(block,0,size);
        }
        if(count!=expectedSize||!hex(digest.digest()).equals(expectedHash))throw new SecurityException("APK integrity mismatch");
    }
    static String digest(byte[] bytes) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
    private static String hex(byte[] bytes){StringBuilder result=new StringBuilder(64);for(byte b:bytes)result.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return result.toString();}
}
