package com.vipgece.customer;

final class UpdateSignalPolicy {
    static final long MIN_HINT_INTERVAL=15L*60*1000;
    private UpdateSignalPolicy() {}
    static boolean shouldCheck(String type,String version,long installed,long now,long last,boolean enabled) {
        if(!enabled||!"customer_update".equals(type)||version==null||!version.matches("[1-9][0-9]{0,9}"))return false;
        long value=Long.parseLong(version);
        return value>installed&&value<=Integer.MAX_VALUE&&now>=0&&(last==0||now>=last&&now-last>=MIN_HINT_INTERVAL);
    }
}
